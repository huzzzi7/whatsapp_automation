/**
 * Phase 6 — No-reply follow-up scheduler.
 * Runs on a repeatable BullMQ tick, finds eligible conversations, enqueues follow-ups, and updates state.
 */
const pool = require('../mysql');
const { toChatId } = require('../phone');
const { resolveGreenApiConfig } = require('../greenInstance');
const { enqueueMessage } = require('../queues/enqueueMessage');
const { logger } = require('../utils/logger');
const {
  listEligibleForFollowup,
  setFollowupState,
} = require('../repositories/conversationStateRepository');
const { insertQueuedJob, markEnqueued } = require('../repositories/followupRepository');

const FOLLOWUP_STEP_DELAYS_HOURS = [6, 24, 48];
const FOLLOWUP_BATCH_LIMIT = Math.max(1, Math.floor(Number(process.env.FOLLOWUP_BATCH_LIMIT || '50') || 50));

const FOLLOWUP_MESSAGES = {
  1: [
    "Hey, just checking if you saw my last message — did you get a chance to look?",
    "Quick follow-up — wanted to make sure my message didn't get lost!",
    "Hi, just circling back in case you missed my last message 👋",
  ],
  2: [
    "Still here if you have questions! Happy to share full details whenever you're ready.",
    "Just a reminder — I can walk you through everything. Let me know if you'd like that.",
    "Wanted to check in one more time. Reply anytime and I'll send the details right over.",
  ],
  3: [
    "This will be my last message — reply 'yes' if you'd like the info, or 'STOP' to unsubscribe.",
    "Final follow-up from me. Interested? Just reply and I'll send everything. Otherwise no worries!",
    "Last one — if you want the details just say the word. If not, reply STOP and I won't message again.",
  ],
};

function getFollowupMessage(step) {
  const options = FOLLOWUP_MESSAGES[step] || [];
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)];
}

function getNextFollowupAt(step) {
  const hours = FOLLOWUP_STEP_DELAYS_HOURS[step] ?? null;
  if (hours === null) return null;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function loadGreenInstanceRow(greenInstanceDbId) {
  const [rows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [
    String(greenInstanceDbId || '').trim(),
  ]);
  return rows[0] || null;
}

async function runFollowupSchedulerTick() {
  const now = new Date();
  const eligible = await listEligibleForFollowup({ now, limit: FOLLOWUP_BATCH_LIMIT });

  for (const conv of eligible) {
    const gid = String(conv.green_instance_db_id || '').trim();
    const phone = String(conv.phone_normalized || '').trim();
    const campaignId = conv.campaign_id != null ? String(conv.campaign_id) : null;

    if (!gid || !phone) continue;

    try {
      const currentStep = Number(conv.followup_step ?? conv.followupStep ?? 0) || 0;
      const nextStep = currentStep + 1;
      if (nextStep < 1 || nextStep > 3) continue;

      const message = getFollowupMessage(nextStep);
      if (!message) continue;

      const nextFollowupAt = getNextFollowupAt(nextStep);

      const instRow = await loadGreenInstanceRow(gid);
      if (!instRow) {
        logger.warn({ event: 'followup_instance_missing', greenInstanceDbId: gid }, 'followup_instance_missing');
        continue;
      }
      const greenApi = resolveGreenApiConfig(instRow);
      const chatId = toChatId(phone);
      if (!chatId) continue;

      const jobRow = await insertQueuedJob({
        greenInstanceDbId: gid,
        phoneNormalized: phone,
        campaignId,
        step: nextStep,
        dueAt: now,
      });

      await enqueueMessage(
        {
          instanceId: greenApi.instanceId,
          apiToken: greenApi.apiToken,
          baseUrl: greenApi.baseUrl,
          chatId,
          message,
          context: 'followup',
          messageCount: nextStep,
          lastMessageAt: conv.last_outbound_at ? new Date(conv.last_outbound_at).getTime() : undefined,
          campaignId: campaignId || '',
          greenInstanceDbId: gid,
          phoneDigits: phone,
          followupStep: nextStep,
          followupJobId: jobRow?.insertId || null,
        },
        'reply',
      );

      await setFollowupState(gid, phone, {
        followupStep: nextStep,
        followupNextAt: nextFollowupAt ? nextFollowupAt.getTime() : null,
        followupCancelled: nextStep >= 3 ? 1 : 0,
      });

      if (jobRow?.insertId) {
        await markEnqueued(jobRow.insertId);
      }

      logger.info(
        { event: 'followup_enqueued', step: nextStep, greenInstanceDbId: gid, phoneNormalized: phone },
        'followup_enqueued',
      );
    } catch (err) {
      logger.error(
        { event: 'followup_scheduler_error', err: err?.message || String(err), phoneNormalized: phone, greenInstanceDbId: gid },
        'followup_scheduler_error',
      );
    }
  }

  logger.info({ event: 'followup_scheduler_tick_done', processed: eligible.length }, 'followup_scheduler_tick_done');
}

module.exports = { runFollowupSchedulerTick, FOLLOWUP_MESSAGES, getFollowupMessage, getNextFollowupAt };

