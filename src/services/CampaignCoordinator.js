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
} = require('../repositories/campaignRepository');
const { runCampaignWorker } = require('./CampaignWorker');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

/** In-process guard: one async worker per campaign id (avoids duplicate workers on repeated tryRunNext). */
const activeWorkerCampaignIds = new Set();

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
  if (activeWorkerCampaignIds.has(campaignId)) return;
  activeWorkerCampaignIds.add(campaignId);
  log.debug(
    { event: 'worker_kick', campaignId, greenInstanceId: meta.greenInstanceId },
    'worker_kick',
  );
  (async () => {
    try {
      await runCampaignWorker(campaignId);
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
      activeWorkerCampaignIds.delete(campaignId);
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
    kickWorker(c.id, { greenInstanceId: c.greenInstanceId });
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
      if (activeWorkerCampaignIds.has(first.id)) return;

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
        kickWorker(first.id, { greenInstanceId: first.greenInstanceId });
      }
    }),
  );
}

module.exports = { tryRunNext };
