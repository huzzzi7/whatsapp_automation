/**
 * BullMQ coordinator worker — replaces setInterval(tryRunNext, 3000).
 * Processes 'coordinator_tick' repeatable jobs from followupQueue.
 * Task 3.4
 */
// Must be set before requiring logger.js (directly or transitively) — see src/utils/logger.js for why.
process.env.LOG_ROLE = process.env.LOG_ROLE || 'coordinatorWorker';
const { Worker } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { tryRunNext } = require('../services/CampaignCoordinator');
const { createLogger } = require('../utils/logger');
// Starts the aiReplyQueue and groupFollowupQueue consumers in this same process — no separate
// PM2 process needed.
const { closeAiReplyWorker } = require('./aiReplyWorker');
const { closeGroupFollowupWorker } = require('./groupFollowupWorker');

const log = createLogger('worker');

async function processCoordinatorTick(job) {
  log.debug({ event: 'coordinator_tick_start', bullJobId: String(job.id) }, 'Coordinator tick running tryRunNext');
  try {
    await tryRunNext();
    log.debug({ event: 'coordinator_tick_complete', bullJobId: String(job.id) }, 'Coordinator tick complete');
  } catch (err) {
    log.error({ err: err.message, bullJobId: String(job.id), event: 'coordinator_tick_error' }, 'Coordinator tick error');
    throw err;
  }
}

const coordinatorWorker = new Worker('followupQueue', processCoordinatorTick, {
  connection: bullMqConnection,
  concurrency: 1,
  skipVersionCheck: bullMqSkipVersionCheck,
});

coordinatorWorker.on('error', (err) => log.error({ err: err.message, event: 'coordinator_worker_error' }, 'CoordinatorWorker error'));
coordinatorWorker.on('failed', (job, err) =>
  log.error({ err: err.message, bullJobId: job?.id, event: 'coordinator_job_failed' }, 'Coordinator tick failed permanently'),
);

log.info({ event: 'coordinator_worker_started', queue: 'followupQueue', concurrency: 1 }, 'CoordinatorWorker started');

async function closeCoordinatorWorker() {
  await coordinatorWorker.close();
  await closeAiReplyWorker();
  await closeGroupFollowupWorker();
  log.info({ event: 'coordinator_worker_closed' }, 'CoordinatorWorker closed');
}

module.exports = { coordinatorWorker, closeCoordinatorWorker };
