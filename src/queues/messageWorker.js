/**
 * BullMQ workers for messageQueue and replyQueue.
 * Processor: apply delay (via controlledSend), check send, log result.
 * Task 3.3 — replaces Phase C inline execution in enqueueMessage.js
 */
const { Worker, DelayedError } = require('bullmq');
const { connectionString, bullMqSkipVersionCheck } = require('./connection');
const { controlledSend } = require('../services/controlledSend');
const {
  getGreenQueueDepth,
  getGreenQueueMax,
  getGreenQueueHardMax,
  isPaused,
  setPauseFlag,
} = require('../services/greenQueueMonitor');
const { getLocalQueueDepth, getLocalQueueMax } = require('../services/localQueueMonitor');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

async function processMessageJob(job, token) {
  const {
    instanceId,
    apiToken,
    baseUrl,
    chatId,
    message,
    context,
    messageCount,
    lastMessageAt,
    greenInstanceDbId,
    phoneDigits,
    campaignId,
  } = job.data;

  const trace = { campaignId: campaignId || undefined, chatId, phoneDigits: phoneDigits || undefined };
  const jobLog = log.child({ ...trace, bullJobId: String(job.id) });

  jobLog.debug(
    { event: 'worker_job_start', queue: job.queueName, context },
    'worker_job_start',
  );

  if (!instanceId || !apiToken || !baseUrl || !chatId || !message) {
    throw new Error(`[Worker] Job ${job.id} missing required fields`);
  }

  // Task 4.4 — Check local BullMQ queue depth before send
  try {
    const localDepth = await getLocalQueueDepth(job.queueName);
    const localMax = getLocalQueueMax();
    if (localDepth >= localMax) {
      log.warn(
        {
          event: 'local_queue_overloaded',
          queue: job.queueName,
          depth: localDepth,
          max: localMax,
          bullJobId: String(job.id),
          chatId,
        },
        'Local queue overloaded',
      );
      await job.moveToDelayed(Date.now() + 30000, token);
      throw new DelayedError();
    }
  } catch (err) {
    if (err.name === 'DelayedError' || err instanceof DelayedError) throw err;
    log.warn({ err: err.message, bullJobId: String(job.id), event: 'local_queue_check_failed' }, 'Local queue check failed');
  }

  // Task 4.2 — Two-tier Green API queue safety rule
  try {
    const paused = await isPaused(instanceId);
    if (paused) {
      log.warn(
        {
          event: 'green_instance_hard_paused',
          bullJobId: String(job.id),
          chatId,
          instanceId,
        },
        'Instance HARD PAUSED (Redis flag active)',
      );
      await job.moveToDelayed(Date.now() + 60000, token);
      throw new DelayedError();
    }

    const greenDepth = await getGreenQueueDepth(instanceId, apiToken, baseUrl);
    const softMax = getGreenQueueMax();
    const hardMax = getGreenQueueHardMax();

    if (greenDepth >= hardMax) {
      log.warn(
        {
          event: 'green_queue_hard_threshold',
          greenDepth,
          hardMax,
          bullJobId: String(job.id),
          instanceId,
        },
        'HARD THRESHOLD exceeded',
      );
      await setPauseFlag(instanceId);
      await job.moveToDelayed(Date.now() + 60000, token);
      throw new DelayedError();
    }

    if (greenDepth >= softMax) {
      log.warn(
        {
          event: 'green_queue_soft_threshold',
          greenDepth,
          softMax,
          bullJobId: String(job.id),
          instanceId,
        },
        'SOFT THRESHOLD exceeded',
      );
      await job.moveToDelayed(Date.now() + 30000, token);
      throw new DelayedError();
    }
  } catch (err) {
    if (err.name === 'DelayedError' || err instanceof DelayedError) throw err;
    log.warn({ err: err.message, bullJobId: String(job.id), event: 'green_queue_check_failed' }, 'Green queue check failed');
  }

  let result;
  try {
    result = await controlledSend({
      instanceId,
      apiToken,
      baseUrl,
      chatId,
      message,
      context,
      messageCount,
      lastMessageAt,
      campaignId,
      phoneDigits,
    });
  } catch (err) {
    jobLog.error({ err: err.message, event: 'worker_job_failed' }, 'Job FAILED');
    throw err;
  }

  if (result.skipped) {
    jobLog.debug({ event: 'worker_job_skipped', context }, 'worker_job_skipped');
  } else {
    jobLog.debug({ event: 'worker_job_complete', delayMs: result.delay, context }, 'worker_job_complete');
  }

  return result;
}

const messageWorker = new Worker('messageQueue', processMessageJob, {
  connection: connectionString,
  concurrency: 1,
  skipVersionCheck: bullMqSkipVersionCheck,
});

const replyWorker = new Worker('replyQueue', processMessageJob, {
  connection: connectionString,
  concurrency: 1,
  skipVersionCheck: bullMqSkipVersionCheck,
});

messageWorker.on('error', (err) => log.error({ err: err.message, queue: 'messageQueue' }, 'Worker messageQueue error'));
replyWorker.on('error', (err) => log.error({ err: err.message, queue: 'replyQueue' }, 'Worker replyQueue error'));

messageWorker.on('failed', (job, err) =>
  log.error({ err: err.message, bullJobId: job?.id, queue: 'messageQueue' }, 'Job failed permanently'),
);
replyWorker.on('failed', (job, err) =>
  log.error({ err: err.message, bullJobId: job?.id, queue: 'replyQueue' }, 'Job failed permanently'),
);

log.info({ event: 'workers_started', concurrency: 1 }, 'messageWorker and replyWorker started');

async function closeWorkers() {
  await Promise.all([messageWorker.close(), replyWorker.close()]);
  log.info({ event: 'workers_closed' }, 'All workers closed');
}

module.exports = { messageWorker, replyWorker, closeWorkers };
