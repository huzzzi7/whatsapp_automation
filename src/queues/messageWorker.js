/**
 * BullMQ workers for messageQueue and replyQueue.
 * Processor: apply delay (via controlledSend), check send, log result.
 * Task 3.3 — replaces Phase C inline execution in enqueueMessage.js
 */
const { Worker, DelayedError } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck, maskRedisHostForLog } = require('./connection');
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

// Cached singleton queues (server must load ./queues/index before this module, as in server.js).
const { messageQueue, replyQueue } = require('./index');

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
    const ctx = String(context || '').trim().toLowerCase();
    if (ctx === 'reply') {
      const prior = Math.floor(Number(job.data?.pipelineSkipRetries || 0));
      const retries = Number.isFinite(prior) && prior >= 0 ? prior : 0;
      const nextRetry = retries + 1;
      const delayMs = 90_000;

      if (retries >= 3) {
        jobLog.warn(
          { event: 'reply_pipeline_skip_dropped', context: ctx, retryCount: retries },
          'Reply pipeline skip retries exceeded; dropping job',
        );
      } else {
        const payload = { ...job.data, pipelineSkipRetries: nextRetry };
        // Requeue same send payload with a delay so the sequence can continue without needing another inbound reply.
        await replyQueue.add('send_message', payload, {
          delay: delayMs,
          removeOnComplete: { count: 20 },
          removeOnFail: { count: 50 },
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          jobId: `${String(job.id)}-pipeline-skip-${nextRetry}-${Date.now()}`,
        });
        jobLog.info(
          { event: 'reply_pipeline_skip_requeued', retryCount: nextRetry, delayMs, context: ctx },
          'Reply pipeline skip requeued',
        );
      }
    }

    jobLog.debug({ event: 'worker_job_skipped', context }, 'worker_job_skipped');
  } else {
    jobLog.debug({ event: 'worker_job_complete', delayMs: result.delay, context }, 'worker_job_complete');
  }

  return result;
}

let messageWorker;
let replyWorker;
try {
  messageWorker = new Worker('messageQueue', processMessageJob, {
    connection: bullMqConnection,
    concurrency: 1,
    skipVersionCheck: bullMqSkipVersionCheck,
  });

  replyWorker = new Worker('replyQueue', processMessageJob, {
    connection: bullMqConnection,
    concurrency: 1,
    skipVersionCheck: bullMqSkipVersionCheck,
  });
} catch (err) {
  log.error(
    { err: err?.message || String(err), event: 'bullmq_worker_failed_to_start' },
    'bullmq_worker_failed_to_start',
  );
  process.exit(1);
}

messageWorker.on('error', (err) => log.error({ err: err.message, queue: 'messageQueue' }, 'Worker messageQueue error'));
replyWorker.on('error', (err) => log.error({ err: err.message, queue: 'replyQueue' }, 'Worker replyQueue error'));

messageWorker.on('failed', (job, err) =>
  log.error({ err: err.message, bullJobId: job?.id, queue: 'messageQueue' }, 'Job failed permanently'),
);
replyWorker.on('failed', (job, err) =>
  log.error({ err: err.message, bullJobId: job?.id, queue: 'replyQueue' }, 'Job failed permanently'),
);

log.info({ event: 'workers_started', concurrency: 1 }, 'messageWorker and replyWorker started');

const STARTUP_REDIS_TIMEOUT_MS = 30000;

function verifyWorkersAndLogHealth() {
  return (async () => {
    const tryClient = (w, queueName) =>
      Promise.race([
        w.client,
        new Promise((_, rej) => {
          setTimeout(() => rej(new Error('redis_client_timeout')), STARTUP_REDIS_TIMEOUT_MS);
        }),
      ]).then(() => queueName);

    try {
      await Promise.all([tryClient(messageWorker, 'messageQueue'), tryClient(replyWorker, 'replyQueue')]);
    } catch (err) {
      log.error(
        { err: err?.message || String(err), event: 'bullmq_worker_failed_to_start' },
        'bullmq_worker_failed_to_start',
      );
      process.exit(1);
    }

    const redisHostMasked = maskRedisHostForLog(bullMqConnection.url);

    log.info(
      {
        event: 'bullmq_worker_alive',
        processPid: process.pid,
        queue: 'messageQueue',
        redisHost: redisHostMasked,
        concurrency: 1,
      },
      'bullmq_worker_alive',
    );
    log.info(
      {
        event: 'bullmq_worker_alive',
        processPid: process.pid,
        queue: 'replyQueue',
        redisHost: redisHostMasked,
        concurrency: 1,
      },
      'bullmq_worker_alive',
    );

    const [msgCounts, replyCounts] = await Promise.all([
      messageQueue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed', 'paused'),
      replyQueue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed', 'paused'),
    ]);

    log.info(
      {
        event: 'bullmq_queue_snapshot',
        processPid: process.pid,
        messageQueue: msgCounts,
        replyQueue: replyCounts,
      },
      'bullmq_queue_snapshot',
    );
  })();
}

verifyWorkersAndLogHealth().catch((err) => {
  log.error(
    { err: err?.message || String(err), event: 'bullmq_worker_failed_to_start' },
    'bullmq_worker_failed_to_start',
  );
  process.exit(1);
});

async function closeWorkers() {
  await Promise.all([messageWorker.close(), replyWorker.close()]);
  log.info({ event: 'workers_closed' }, 'All workers closed');
}

module.exports = { messageWorker, replyWorker, closeWorkers };
