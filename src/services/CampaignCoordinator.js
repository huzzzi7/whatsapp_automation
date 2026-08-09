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
const { acquireCampaignWorkerLock } = require('./campaignWorkerLock');
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
    // activeWorkerKeys only guards within this process — server and coordinatorWorker are
    // separate processes with separate memory, so a Redis lock is what actually stops both from
    // running the same campaign's send loop at once (see campaignWorkerLock.js).
    const lock = await acquireCampaignWorkerLock(campaignId);
    if (!lock) {
      // Another process already owns this campaign's send loop (or Redis was unreachable) — free
      // the key without rescheduling, so this doesn't busy-loop retrying every tick; the process
      // actually running it will drive progress, and the next external tick/action picks up here.
      log.debug(
        { event: 'worker_kick_lock_held_elsewhere', campaignId },
        'Another process already holds the campaign worker lock, skipping',
      );
      activeWorkerKeys.delete(key);
      return;
    }
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
      await lock.release();
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
