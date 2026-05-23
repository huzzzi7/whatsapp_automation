/**
 * Multi-instance campaign runner: at most one running worker per green_instance_id;
 * parallel workers across different instances. DB promotion uses NOT EXISTS per instance (race-safe).
 *
 * tryRunNext never awaits worker completion: kickWorker only schedules independent async IIFEs.
 * Queued promotion: one getRunningCampaignByInstance + at most one promote per instance per tick, all instances in parallel.
 */
const {
  getRunningCampaigns,
  getRunningCampaignByInstance,
  getQueuedCampaignsDueOrdered,
  updateCampaignStatus,
  getCampaignById,
  promoteQueuedCampaignToRunningIfDue,
  claimPausedAsRunningIfInstanceFree,
} = require('../repositories/campaignRepository');
const { runCampaignWorker } = require('./CampaignWorker');
const { createLogger } = require('../utils/logger');
const pool = require('../mysql');

const log = createLogger('worker');

/** In-process guard: one async worker per campaign+instance key (avoids duplicates on repeated tryRunNext). */
const activeWorkerKeys = new Set();

function scheduleTryRunNext() {
  setImmediate(() => {
    tryRunNext().catch((e) =>
      log.error(
        { event: 'coordinator_chain_error', err: e?.message || String(e) },
        'coordinator_chain_error',
      ),
    );
  });
}

/**
 * Starts an independent async worker for this campaign (no await here — parallel dispatch).
 * @param {string} campaignId
 * @param {{ greenInstanceId?: string }} [meta] - for logs only
 */
function kickWorker(campaignId, meta = {}) {
  const workerInstanceId = meta.workerInstanceId != null ? String(meta.workerInstanceId).trim() : '';
  const key = `${campaignId}:${workerInstanceId || 'default'}`;
  if (activeWorkerKeys.has(key)) return;
  activeWorkerKeys.add(key);
  log.debug(
    { event: 'worker_kick', campaignId, greenInstanceId: meta.greenInstanceId, workerInstanceId: workerInstanceId || undefined },
    'worker_kick',
  );
  (async () => {
    try {
      await runCampaignWorker(campaignId, { workerInstanceId: workerInstanceId || undefined });
    } catch (err) {
      log.error(
        {
          event: 'coordinator_worker_error',
          campaignId,
          err: err?.message || String(err),
        },
        'coordinator_worker_error',
      );
      const c = await getCampaignById(campaignId);
      if (c && c.status === 'running') {
        await updateCampaignStatus(campaignId, 'failed', {
          errorMessage: err?.message || 'Campaign worker failed.',
        });
      }
    } finally {
      activeWorkerKeys.delete(key);
      scheduleTryRunNext();
    }
  })();
}

/** Group queued campaigns by instance; list order per group = global queue_order (input is already ordered). */
function groupQueuedByInstance(queuedDue) {
  const map = new Map();
  for (const q of queuedDue) {
    const gid = String(q.greenInstanceId || '').trim();
    if (!gid) continue;
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid).push(q);
  }
  return map;
}

async function tryRunNext() {
  const runningDb = await getRunningCampaigns();

  // Fire every running worker without awaiting — same event-loop turn for all kicks.
  for (const c of runningDb) {
    if (c.isMultiInstance) {
      const [rows] = await pool.execute(
        `SELECT DISTINCT cc.assigned_instance_id AS instanceId
         FROM campaign_contacts cc
         INNER JOIN green_instances gi
           ON gi.id = cc.assigned_instance_id
          AND gi.isActive = 1
          AND gi.manualDisabled = 0
         WHERE cc.campaign_id = ?
           AND cc.first_send_status = 'pending'
           AND cc.assigned_instance_id IS NOT NULL
           AND cc.assigned_instance_id != ''
         ORDER BY cc.assigned_instance_id ASC`,
        [c.id],
      );
      const ids = rows.map((r) => String(r.instanceId || '').trim()).filter(Boolean);
      for (const workerInstanceId of ids) {
        kickWorker(c.id, { greenInstanceId: c.greenInstanceId, workerInstanceId });
      }
    } else {
      kickWorker(c.id, { greenInstanceId: c.greenInstanceId });
    }
  }

  const queuedDue = await getQueuedCampaignsDueOrdered();
  log.debug({ event: 'coordinator_tick_running', runningCount: runningDb.length }, 'coordinator_tick_running');
  log.debug({ event: 'coordinator_tick_queued', queuedCount: queuedDue.length }, 'coordinator_tick_queued');

  const byInstance = groupQueuedByInstance(queuedDue);
  const instanceIds = [...byInstance.keys()];

  await Promise.all(
    instanceIds.map(async (gid) => {
      const queued = byInstance.get(gid) || [];

      const busy = await getRunningCampaignByInstance(gid);
      if (busy) return;

      const first = queued[0];
      if (!first) return;
      if (activeWorkerKeys.has(`${first.id}:default`)) return;

      const promoted = await promoteQueuedCampaignToRunningIfDue(first.id);

      if (promoted === 1) {
        log.debug(
          {
            event: 'campaign_promoted',
            campaignId: first.id,
            greenInstanceId: first.greenInstanceId,
          },
          'campaign_promoted',
        );
        const promotedCampaign = await getCampaignById(first.id);
        if (promotedCampaign?.isMultiInstance) {
          const [rows] = await pool.execute(
            `SELECT DISTINCT cc.assigned_instance_id AS instanceId
             FROM campaign_contacts cc
             INNER JOIN green_instances gi
               ON gi.id = cc.assigned_instance_id
              AND gi.isActive = 1
              AND gi.manualDisabled = 0
             WHERE cc.campaign_id = ?
               AND cc.first_send_status = 'pending'
               AND cc.assigned_instance_id IS NOT NULL
               AND cc.assigned_instance_id != ''
             ORDER BY cc.assigned_instance_id ASC`,
            [first.id],
          );
          const ids = rows.map((r) => String(r.instanceId || '').trim()).filter(Boolean);
          for (const workerInstanceId of ids) {
            kickWorker(first.id, { greenInstanceId: first.greenInstanceId, workerInstanceId });
          }
        } else {
          kickWorker(first.id, { greenInstanceId: first.greenInstanceId });
        }
      }
    }),
  );

  // Phase C: auto-resume campaigns paused by the recalculator (not user-paused)
  try {
    const [autoPaused] = await pool.execute(
      `SELECT id FROM campaigns
       WHERE status = 'paused'
         AND error_message IN (
           'auto_paused: all instances unauthorized',
           'auto_paused: assigned instance unauthorized',
           'auto_paused: instance went unauthorized during campaign'
         )`
    );
    for (const c of autoPaused || []) {
      const claimed = await claimPausedAsRunningIfInstanceFree(c.id);
      if (claimed === 1) {
        log.info({ event: 'coordinator_auto_resume', campaignId: c.id }, 'coordinator auto-resumed recalculator-paused campaign');
        kickWorker(c.id, {});
      }
    }
  } catch (err) {
    log.error({ event: 'coordinator_auto_resume_error', err: err?.message || String(err) }, 'Phase C auto-resume error');
  }
}

module.exports = { tryRunNext };
