/**
 * Campaign coordinator: promotes queued campaigns to running, kicks workers.
 */
const {
  getRunningCampaigns,
  getQueuedCampaignsDueOrdered,
  updateCampaignStatus,
  getCampaignById,
  promoteQueuedCampaignToRunningIfDue,
} = require('../repositories/campaignRepository');
const { runCampaignWorker } = require('./CampaignWorker');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

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

function kickWorker(campaignId) {
  const key = String(campaignId);
  if (activeWorkerKeys.has(key)) return;
  activeWorkerKeys.add(key);
  log.debug({ event: 'worker_kick', campaignId }, 'worker_kick');
  (async () => {
    try {
      await runCampaignWorker(campaignId);
    } catch (err) {
      log.error(
        { event: 'coordinator_worker_error', campaignId, err: err?.message || String(err) },
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

async function tryRunNext() {
  const runningDb = await getRunningCampaigns();
  for (const c of runningDb) {
    kickWorker(c.id);
  }

  const queuedDue = await getQueuedCampaignsDueOrdered();
  log.debug({ event: 'coordinator_tick_running', runningCount: runningDb.length }, 'coordinator_tick_running');
  log.debug({ event: 'coordinator_tick_queued', queuedCount: queuedDue.length }, 'coordinator_tick_queued');

  for (const q of queuedDue) {
    if (activeWorkerKeys.has(String(q.id))) continue;
    const promoted = await promoteQueuedCampaignToRunningIfDue(q.id);
    if (promoted === 1) {
      log.debug({ event: 'campaign_promoted', campaignId: q.id }, 'campaign_promoted');
      kickWorker(q.id);
    }
  }
}

module.exports = { tryRunNext };
