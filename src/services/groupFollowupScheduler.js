/**
 * Schedules the "send the ticket link a few minutes after the group link" follow-up. Same
 * debounce-by-phone pattern as aiReplyScheduler.js — a repeat click on "Get Group Link" replaces
 * any still-pending follow-up for that phone rather than stacking a second one.
 */
const { groupFollowupQueue } = require('../queues');
const { createLogger } = require('../utils/logger');

const log = createLogger('groupFollowupScheduler');

const DEFAULT_MIN_MS = 3 * 60 * 1000;
const DEFAULT_MAX_MS = 6 * 60 * 1000;

function getDelayRange() {
  const min = parseInt(process.env.GROUP_FOLLOWUP_DELAY_MIN_MS || '', 10);
  const max = parseInt(process.env.GROUP_FOLLOWUP_DELAY_MAX_MS || '', 10);
  const minMs = Number.isFinite(min) && min >= 0 ? min : DEFAULT_MIN_MS;
  const maxMs = Number.isFinite(max) && max >= minMs ? max : Math.max(minMs, DEFAULT_MAX_MS);
  return { minMs, maxMs };
}

function randomDelayMs() {
  const { minMs, maxMs } = getDelayRange();
  if (maxMs <= minMs) return minMs;
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

/**
 * @param {{ fromPhone: string, campaignId: string|null, contactPayloadJson: string|null }} params
 */
async function scheduleTicketFollowup({ fromPhone, campaignId, contactPayloadJson }) {
  // BullMQ custom job ids cannot contain ':' (used internally as a Redis key delimiter).
  const jobId = `group_followup-${fromPhone}`;

  try {
    const existing = await groupFollowupQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'delayed' || state === 'waiting') {
        await existing.remove();
      }
    }
  } catch (err) {
    log.warn(
      { err: err.message, event: 'group_followup_debounce_check_failed', fromPhone },
      'Failed to check for a pending group follow-up job, scheduling anyway',
    );
  }

  const delayMs = randomDelayMs();
  try {
    await groupFollowupQueue.add(
      'send_ticket_followup',
      { fromPhone, campaignId, contactPayloadJson },
      {
        jobId,
        delay: delayMs,
        // Free the jobId as soon as this job finishes (success or failure) — it's reused as a
        // fixed debounce key per phone number, so a lingering completed/failed job with the same
        // id would make the next add() for this contact throw a duplicate-job error.
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    log.info({ event: 'group_followup_scheduled', fromPhone, delayMs }, 'group_followup_scheduled');
  } catch (err) {
    log.warn(
      { err: err.message, event: 'group_followup_schedule_failed', fromPhone },
      'Failed to schedule ticket-link follow-up',
    );
  }
}

module.exports = { scheduleTicketFollowup };
