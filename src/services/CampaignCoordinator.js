/**
 * Single-flight campaign runner: one coordinator pass at a time (isRunning mutex).
 * Picks DB `running` campaigns (resume) or promotes `queued` → `running`, then runs the worker.
 */
const {
  getNextQueuedCampaign,
  getRunningCampaign,
  updateCampaignStatus,
  getCampaignById,
  promoteQueuedCampaignToRunningIfDue,
} = require('../repositories/campaignRepository');
const { runCampaignWorker } = require('./CampaignWorker');

let isRunning = false;

async function tryRunNext() {
  if (isRunning) return;
  isRunning = true;

  let workerInvoked = false;
  let activeCampaignId = null;

  try {
    const existingRunning = await getRunningCampaign();
    if (existingRunning) {
      activeCampaignId = existingRunning.id;
      workerInvoked = true;
      await runCampaignWorker(existingRunning.id);
      return;
    }

    const next = await getNextQueuedCampaign();
    if (!next) return;

    const promoted = await promoteQueuedCampaignToRunningIfDue(next.id);
    if (promoted !== 1) {
      console.log('[Scheduler] Campaign not due yet (DB controlled)');
      return;
    }
    console.log('[Scheduler] Campaign promoted to running:', next.id);
    activeCampaignId = next.id;
    workerInvoked = true;
    await runCampaignWorker(next.id);
  } catch (err) {
    console.error('[CampaignCoordinator] Worker error:', err?.message || err);
    if (activeCampaignId) {
      const c = await getCampaignById(activeCampaignId);
      if (c && c.status === 'running') {
        await updateCampaignStatus(activeCampaignId, 'failed', {
          errorMessage: err?.message || 'Campaign worker failed.',
        });
      }
    }
  } finally {
    isRunning = false;
    if (workerInvoked) {
      setImmediate(() => {
        tryRunNext().catch((e) => console.error('[CampaignCoordinator] tryRunNext chain:', e?.message || e));
      });
    }
  }
}

module.exports = { tryRunNext };
