/**
 * Queue-first send path: enqueue job; workers run controlledSend.
 */
const { messageQueue, replyQueue } = require('./index');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

/**
 * @param {object} payload
 * @param {'message'|'reply'} [queueTarget]
 */
async function enqueueMessage(payload, queueTarget = 'message') {
  const jobId = `${payload.greenInstanceDbId || 'x'}-${payload.phoneDigits || payload.chatId}-${payload.messageCount ?? 0}-${Date.now()}`;
  const jobOptions = {
    jobId,
    removeOnComplete: { count: 20 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  };

  try {
    const queue = queueTarget === 'reply' ? replyQueue : messageQueue;
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
