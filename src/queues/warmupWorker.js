/**
 * Phase 5 — BullMQ worker for warmupQueue.
 * Runs the same guarded send pipeline as messageWorker, but updates warmup DB rows.
 */
const { Worker, DelayedError } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { controlledSend } = require('../services/controlledSend');
const {
  getGreenQueueDepth,
  getGreenQueueMax,
  getGreenQueueHardMax,
  isPaused,
  setPauseFlag,
} = require('../services/greenQueueMonitor');
const { getLocalQueueDepth, getLocalQueueMax } = require('../services/localQueueMonitor');
const warmupRepository = require('../repositories/warmupRepository');
const { startWarmupSession } = require('../services/WarmupCoordinator');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

async function processWarmupJob(job, token) {
  if (job && (job.name === 'warmup_morning' || job.name === 'warmup_evening')) {
    const jobLog = log.child({ bullJobId: String(job.id), name: job.name, queue: job.queueName });
    jobLog.info({ event: 'warmup_schedule_tick', name: job.name }, 'warmup_schedule_tick');
    try {
      const result = await startWarmupSession();
      jobLog.info(
        { event: 'warmup_schedule_started', alreadyRunning: Boolean(result?.alreadyRunning) },
        'warmup_schedule_started',
      );
    } catch (err) {
      jobLog.error({ event: 'warmup_schedule_error', err: err?.message || String(err) }, 'warmup_schedule_error');
      throw err;
    }
    return { ok: true };
  }

  const {
    instanceId,
    apiToken,
    baseUrl,
    chatId,
    message,
    context,
    messageCount,
    lastMessageAt,
    warmupMessageId,
    pairId,
    sessionId,
    role,
    messageIndex,
  } = job.data || {};

  const jobLog = log.child({
    bullJobId: String(job.id),
    queue: job.queueName,
    pairId: pairId || undefined,
    sessionId: sessionId || undefined,
    warmupMessageId: warmupMessageId != null ? Number(warmupMessageId) : undefined,
    role: role || undefined,
  });

  if (!instanceId || !apiToken || !baseUrl || !chatId || !message) {
    throw new Error(`[WarmupWorker] Job ${job.id} missing required fields`);
  }

  // Local backlog guard (Phase 4.4)
  try {
    const localDepth = await getLocalQueueDepth(job.queueName);
    const localMax = getLocalQueueMax();
    if (localDepth >= localMax) {
      jobLog.warn({ event: 'local_queue_overloaded', depth: localDepth, max: localMax }, 'Local queue overloaded');
      await job.moveToDelayed(Date.now() + 30000, token);
      throw new DelayedError();
    }
  } catch (err) {
    if (err.name === 'DelayedError' || err instanceof DelayedError) throw err;
    jobLog.warn({ err: err.message, event: 'local_queue_check_failed' }, 'Local queue check failed');
  }

  // Green queue guard (Phase 4.2)
  try {
    const paused = await isPaused(instanceId);
    if (paused) {
      jobLog.warn({ event: 'green_instance_hard_paused', instanceId }, 'Instance HARD PAUSED (Redis flag active)');
      await job.moveToDelayed(Date.now() + 60000, token);
      throw new DelayedError();
    }

    const greenDepth = await getGreenQueueDepth(instanceId, apiToken, baseUrl);
    const softMax = getGreenQueueMax();
    const hardMax = getGreenQueueHardMax();

    if (greenDepth >= hardMax) {
      jobLog.warn({ event: 'green_queue_hard_threshold', greenDepth, hardMax, instanceId }, 'HARD THRESHOLD exceeded');
      await setPauseFlag(instanceId);
      await job.moveToDelayed(Date.now() + 60000, token);
      throw new DelayedError();
    }

    if (greenDepth >= softMax) {
      jobLog.warn({ event: 'green_queue_soft_threshold', greenDepth, softMax, instanceId }, 'SOFT THRESHOLD exceeded');
      await job.moveToDelayed(Date.now() + 30000, token);
      throw new DelayedError();
    }
  } catch (err) {
    if (err.name === 'DelayedError' || err instanceof DelayedError) throw err;
    jobLog.warn({ err: err.message, event: 'green_queue_check_failed' }, 'Green queue check failed');
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
      campaignId: `warmup-${sessionId || ''}`,
      phoneDigits: undefined,
    });
  } catch (err) {
    jobLog.error({ err: err.message, event: 'warmup_job_send_failed' }, 'Warmup send FAILED');
    if (warmupMessageId != null) {
      await warmupRepository.updateMessageStatus(warmupMessageId, 'failed', { errorMessage: err.message });
    }
    throw err;
  }

  if (result.skipped) {
    // Warmup is expected to be non-skipping; if behaviorEngine ever skips, treat as failed so coordinator can see it.
    const msg = 'Warmup message skipped by pipeline';
    jobLog.warn({ event: 'warmup_message_skipped', context }, msg);
    if (warmupMessageId != null) {
      await warmupRepository.updateMessageStatus(warmupMessageId, 'failed', { errorMessage: msg });
    }
    throw new Error(msg);
  }

  // Guard: skip DB update if pair already exited (timeout race)
  if (pairId) {
    const pairRow = await warmupRepository.getPairById(pairId);
    if (pairRow && (pairRow.status === 'failed' || pairRow.status === 'completed')) {
      jobLog.warn(
        { event: 'warmup_orphan_job_skipped', pairId, warmupMessageId },
        'Pair already terminal; skipping orphan job DB update',
      );
      return result;
    }
  }

  if (warmupMessageId != null) {
    await warmupRepository.updateMessageStatus(warmupMessageId, 'sent');
  }
  if (pairId) {
    await warmupRepository.incrementPairMessagesSent(pairId);
  }

  jobLog.info(
    {
      event: 'warmup_message_sent',
      warmupMessageId: warmupMessageId != null ? Number(warmupMessageId) : undefined,
      pairId,
      sessionId,
      role,
      messageIndex,
      delayMs: result.delay,
    },
    'warmup_message_sent',
  );

  return result;
}

const warmupWorker = new Worker('warmupQueue', processWarmupJob, {
  connection: bullMqConnection,
  concurrency: 3,
  skipVersionCheck: bullMqSkipVersionCheck,
});

warmupWorker.on('error', (err) =>
  log.error({ err: err.message, queue: 'warmupQueue', event: 'warmup_worker_error' }, 'WarmupWorker error'),
);
warmupWorker.on('failed', (job, err) =>
  log.error({ err: err.message, bullJobId: job?.id, queue: 'warmupQueue' }, 'Warmup job failed permanently'),
);

log.info({ event: 'warmup_worker_started', queue: 'warmupQueue', concurrency: 3 }, 'WarmupWorker started');

async function closeWarmupWorker() {
  await warmupWorker.close();
  log.info({ event: 'warmup_worker_closed' }, 'WarmupWorker closed');
}

module.exports = { warmupWorker, closeWarmupWorker };

