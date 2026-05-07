/**
 * Queue-first send path: enqueue job; workers run controlledSend.
 */
const { messageQueue, replyQueue, warmupQueue } = require('./index');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

/**
 * @param {object} payload
 * @param {'message'|'reply'|'warmup'} [queueTarget]
 */
async function enqueueMessage(payload, queueTarget = 'message') {
  // Deterministic jobId: same contact + same sequence step always produces same id.
  // This lets BullMQ naturally reject duplicate enqueues for the same contact in the same campaign.
  // For campaign messages: greenInstanceDbId-phone-messageCount-campaignId
  // For reply/warmup: greenInstanceDbId-phone-messageCount-timestamp (still needs uniqueness)
  const isCampaign = String(payload.context || '').toLowerCase() === 'campaign' && payload.campaignId;
  const jobId = isCampaign
    ? `${payload.greenInstanceDbId || 'x'}-${payload.phoneDigits || payload.chatId}-${payload.messageCount ?? 0}-${payload.campaignId}`
    : `${payload.greenInstanceDbId || 'x'}-${payload.phoneDigits || payload.chatId}-${payload.messageCount ?? 0}-${Date.now()}`;

  const jobOptions = {
    jobId,
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  };

  // Pre-enqueue dedup: if a job with this deterministic id already exists in any active state, skip.
  if (isCampaign) {
    try {
      const queue = messageQueue;
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (['waiting', 'active', 'delayed', 'paused'].includes(state)) {
          log.warn(
            { event: 'job_dedup_skipped', jobId, chatId: payload.chatId, campaignId: payload.campaignId },
            'Duplicate campaign job skipped — already in queue',
          );
          return { queued: true, deduped: true };
        }
      }
    } catch (dedupErr) {
      log.warn({ err: dedupErr.message, event: 'dedup_check_failed' }, 'Dedup check failed, proceeding');
    }
  }

  try {
    const queue =
      queueTarget === 'reply'
        ? replyQueue
        : queueTarget === 'warmup'
          ? warmupQueue
          : messageQueue;
    await queue.add('send_message', payload, jobOptions);
    log.debug(
      {
        event: 'job_enqueued',
        queueTarget,
        chatId: payload.chatId,
        context: payload.context,
        campaignId: payload.campaignId || undefined,
        phoneDigits: payload.phoneDigits || undefined,
      },
      'job_enqueued',
    );
  } catch (queueErr) {
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
      log.warn(
        { err: queueErr.message, event: 'queue_fallback_direct_send' },
        'Queue unavailable, falling back to direct send',
      );
      const { controlledSend: runSend } = require('../services/controlledSend');
      return runSend({
        instanceId: payload.instanceId,
        apiToken: payload.apiToken,
        baseUrl: payload.baseUrl,
        chatId: payload.chatId,
        message: payload.message,
        context: payload.context,
        messageCount: payload.messageCount,
        lastMessageAt: payload.lastMessageAt,
        campaignId: payload.campaignId,
        phoneDigits: payload.phoneDigits,
      });
    }
    log.error({ err: queueErr.message, event: 'queue_add_failed' }, 'Queue failed (production), hard fail');
    throw queueErr;
  }

  // Worker handles execution asynchronously via messageWorker.js
  return { queued: true };
}

module.exports = { enqueueMessage };
