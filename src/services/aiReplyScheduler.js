/**
 * Schedules AI-generated free-text replies with a human-like delay instead of sending them the
 * instant a webhook arrives. Debounces rapid follow-up messages from the same contact — each new
 * message replaces the still-pending job for that phone number, so only the last one in a burst
 * ends up triggering a reply, with a fresh delay counted from that last message.
 */
const { aiReplyQueue } = require('../queues');
const { createLogger } = require('../utils/logger');

const log = createLogger('aiReplyScheduler');

const DEFAULT_MIN_MS = 2 * 60 * 1000;
const DEFAULT_MAX_MS = 5 * 60 * 1000;

function getDelayRange() {
  const min = parseInt(process.env.AI_REPLY_DELAY_MIN_MS || '', 10);
  const max = parseInt(process.env.AI_REPLY_DELAY_MAX_MS || '', 10);
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
 * @param {{ fromPhone: string, campaignId: string|null, bodyText: string,
 *   contactPayloadJson: string|null, metaMessageId: string|null }} params
 */
async function scheduleAiReply({ fromPhone, campaignId, bodyText, contactPayloadJson, metaMessageId }) {
  const jobId = `ai_reply:${fromPhone}`;

  try {
    const existing = await aiReplyQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'delayed' || state === 'waiting') {
        await existing.remove();
      }
    }
  } catch (err) {
    log.warn(
      { err: err.message, event: 'ai_reply_debounce_check_failed', fromPhone },
      'Failed to check for a pending AI reply job, scheduling anyway',
    );
  }

  const delayMs = randomDelayMs();
  try {
    await aiReplyQueue.add(
      'send_ai_reply',
      { fromPhone, campaignId, bodyText, contactPayloadJson, metaMessageId },
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
    log.info({ event: 'ai_reply_scheduled', fromPhone, delayMs }, 'ai_reply_scheduled');
  } catch (err) {
    log.warn(
      { err: err.message, event: 'ai_reply_schedule_failed', fromPhone },
      'Failed to schedule AI reply (a reply for this contact is likely already in flight)',
    );
  }
}

module.exports = { scheduleAiReply };
