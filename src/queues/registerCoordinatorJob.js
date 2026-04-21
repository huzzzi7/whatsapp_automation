/**
 * Registers the coordinator_tick repeatable job on followupQueue.
 * Safe to call multiple times — BullMQ deduplicates by repeat key.
 * Task 3.4
 */
const { followupQueue } = require('./index');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

async function registerCoordinatorJob() {
  await followupQueue.add(
    'coordinator_tick',
    {},
    {
      repeat: { every: 3000 },
      jobId: 'coordinator_tick',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
      attempts: 1,
    },
  );
  log.info({ event: 'coordinator_job_registered', intervalMs: 3000 }, 'coordinator_tick repeatable job registered');
}

module.exports = { registerCoordinatorJob };
