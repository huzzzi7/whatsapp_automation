/**
 * Phase 6 — BullMQ worker for follow-up scheduler tick.
 * Dedicated queue: followupSchedulerQueue (prevents stealing coordinator_tick jobs).
 */
const { Worker } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { runFollowupSchedulerTick } = require('../services/followupScheduler');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

async function processFollowupSchedulerTick(job) {
  const startedAt = Date.now();

  if (job.name !== 'followup_scheduler_tick') {
    log.warn({ event: 'followup_scheduler_unexpected_job', name: job.name, bullJobId: String(job.id) }, 'Unexpected job on followup scheduler queue');
    return;
  }

  log.debug({ event: 'followup_scheduler_tick_start', bullJobId: String(job.id) }, 'Follow-up scheduler tick start');
  try {
    await runFollowupSchedulerTick();
    const ms = Date.now() - startedAt;
    log.debug({ event: 'followup_scheduler_tick_complete', bullJobId: String(job.id), durationMs: ms }, 'Follow-up scheduler tick complete');
  } catch (err) {
    // Non-fatal: do not throw so BullMQ does not retry aggressively.
    log.error({
      event: 'followup_scheduler_tick_error',
      bullJobId: job.id,
      err: err.message,
      stack: err.stack,
      msg: 'Follow-up scheduler tick error',
    });
  }
}

// Dedicated queue name string matches Queue('followupSchedulerQueue', ...)
const followupSchedulerWorker = new Worker('followupSchedulerQueue', processFollowupSchedulerTick, {
  connection: bullMqConnection,
  concurrency: 1,
  skipVersionCheck: bullMqSkipVersionCheck,
});

followupSchedulerWorker.on('error', (err) =>
  log.error({ err: err.message, queue: 'followupSchedulerQueue', event: 'followup_scheduler_worker_error' }, 'FollowupSchedulerWorker error'),
);

log.info({ event: 'followup_scheduler_worker_started', queue: 'followupSchedulerQueue', concurrency: 1 }, 'FollowupSchedulerWorker started');

async function closeFollowupSchedulerWorker() {
  await followupSchedulerWorker.close();
  log.info({ event: 'followup_scheduler_worker_closed' }, 'FollowupSchedulerWorker closed');
}

module.exports = { followupSchedulerWorker, closeFollowupSchedulerWorker };

