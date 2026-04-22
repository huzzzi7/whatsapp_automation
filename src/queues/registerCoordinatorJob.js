/**
 * Registers the coordinator_tick repeatable job on followupQueue.
 * Removes prior coordinator_tick repeatables so interval/env changes apply (BullMQ dedup key).
 * Task 3.4
 */
const { followupQueue } = require('./index');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

function getCoordinatorTickMs() {
  const raw = parseInt(process.env.COORDINATOR_TICK_MS || '15000', 10);
  if (!Number.isFinite(raw)) return 15000;
  return Math.max(5000, Math.min(raw, 300_000));
}

async function registerCoordinatorJob() {
  const tickMs = getCoordinatorTickMs();

  try {
    const repeatables = await followupQueue.getRepeatableJobs();
    for (const r of repeatables) {
      if (String(r.name) === 'coordinator_tick' && r.key) {
        await followupQueue.removeRepeatableByKey(r.key);
        log.info({ event: 'coordinator_repeatable_removed', key: r.key }, 'removed prior coordinator_tick repeatable');
      }
    }
  } catch (err) {
    log.warn(
      { err: err?.message || String(err), event: 'coordinator_repeatable_remove_failed' },
      'could not remove prior coordinator_tick repeatables (continuing)',
    );
  }

  await followupQueue.add(
    'coordinator_tick',
    {},
    {
      repeat: { every: tickMs },
      jobId: 'coordinator_tick',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
      attempts: 1,
    },
  );
  log.info({ event: 'coordinator_job_registered', intervalMs: tickMs }, 'coordinator_tick repeatable job registered');
}

module.exports = { registerCoordinatorJob };
