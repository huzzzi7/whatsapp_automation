/**
 * Phase 6 — Registers the followup_scheduler_tick repeatable job.
 * Follows registerCoordinatorJob.js pattern.
 */
const { followupSchedulerQueue } = require('./index');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

function getFollowupTickMs() {
  const raw = parseInt(process.env.FOLLOWUP_TICK_MS || '300000', 10);
  if (!Number.isFinite(raw)) return 300000;
  return Math.max(60_000, Math.min(raw, 3_600_000));
}

async function registerFollowupSchedulerJob() {
  const tickMs = getFollowupTickMs();
  const jobName = 'followup_scheduler_tick';
  const stableJobId = 'followup-scheduler-tick-singleton';

  try {
    const repeatables = await followupSchedulerQueue.getRepeatableJobs();
    for (const r of repeatables) {
      if (String(r.name) === jobName && r.key) {
        await followupSchedulerQueue.removeRepeatableByKey(r.key);
        log.info({ event: 'followup_scheduler_repeatable_removed', key: r.key }, 'removed prior followup_scheduler_tick repeatable');
      }
    }
  } catch (err) {
    log.warn(
      { err: err?.message || String(err), event: 'followup_scheduler_repeatable_remove_failed' },
      'could not remove prior followup_scheduler_tick repeatables (continuing)',
    );
  }

  await followupSchedulerQueue.add(
    jobName,
    {},
    {
      repeat: { every: tickMs },
      jobId: stableJobId,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
      attempts: 1,
    },
  );

  log.info({ event: 'followup_scheduler_job_registered', intervalMs: tickMs }, 'followup_scheduler_tick repeatable job registered');
}

module.exports = { registerFollowupSchedulerJob };

