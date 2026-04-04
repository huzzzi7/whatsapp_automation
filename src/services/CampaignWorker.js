/**
 * DB-backed campaign execution: send message 1 per contact via replyFlow + production state store.
 */
const pool = require('../mysql');
const appConfig = require('../../config');
const state = require('../state');
const { buildSequence } = require('../messages');
const { sendFirstMessageOnlyWithStore } = require('../replyFlow');
const { resolveGreenApiConfig } = require('../greenInstance');
const {
  getCampaignById,
  getPendingContacts,
  markContactSent,
  markContactFailed,
  markContactSkipped,
  incrementSentCount,
  incrementFailedCount,
  incrementSkippedCount,
  updateCampaignStatus,
} = require('../repositories/campaignRepository');

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePayload(payloadJson) {
  if (payloadJson == null || payloadJson === '') return {};
  try {
    const s = typeof payloadJson === 'string' ? payloadJson : String(payloadJson);
    const obj = JSON.parse(s);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    console.warn('[CampaignWorker] Invalid payload_json, using empty object:', e.message);
    return {};
  }
}

function contactsToUsers(contacts) {
  return contacts.map((c) => {
    const base = parsePayload(c.payloadJson);
    return {
      ...base,
      phone: c.phoneNormalized,
    };
  });
}

function firstMessageEmpty(user) {
  const sequence = user.sequence || buildSequence(user, appConfig.messageTemplates);
  if (!sequence || sequence.length < 1) return true;
  const text = sequence[0];
  return text == null || String(text).trim() === '';
}

async function runCampaignWorker(campaignId) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const [instRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [
    campaign.greenInstanceId,
  ]);
  const instRow = instRows[0];
  if (!instRow) {
    throw new Error(`Green instance not found for campaign: ${campaign.greenInstanceId}`);
  }

  const greenApi = resolveGreenApiConfig(instRow);
  const greenInstanceDbId = campaign.greenInstanceId;
  const stableCampaignId = `campaign-${campaignId}`;

  let batchNum = 0;

  while (true) {
    const current = await getCampaignById(campaignId);
    if (!current) {
      throw new Error(`Campaign disappeared: ${campaignId}`);
    }

    if (current.status === 'paused') {
      console.log(`[CampaignWorker] Campaign ${campaignId} paused (before batch)`);
      return;
    }
    if (current.status !== 'running') {
      console.log(`[CampaignWorker] Campaign ${campaignId} stopped (status: ${current.status})`);
      return;
    }

    const batchSize = Math.max(1, Number(current.batchSize) || 20);
    const delaySeconds = Math.max(0, Number(current.delaySeconds) || 0);
    const messageDelayMs = Math.max(0, Number(current.messageDelaySeconds) || 0) * 1000;

    const contacts = await getPendingContacts(campaignId, batchSize);

    if (contacts.length === 0) {
      await updateCampaignStatus(campaignId, 'completed');
      console.log('[CampaignWorker] Campaign completed:', campaignId);
      break;
    }

    batchNum += 1;
    console.log(`[CampaignWorker] Processing batch ${batchNum} for campaign ${campaignId}`);
    console.log(`[CampaignWorker] Sending to ${contacts.length} users`);

    const users = contactsToUsers(contacts);

    const pauseCheck = async () => {
      const c = await getCampaignById(campaignId);
      if (!c) return true;
      if (c.status === 'paused') {
        console.log(`[CampaignWorker] Worker stopped due to pause (mid-batch): ${campaignId}`);
        return true;
      }
      if (c.status !== 'running') {
        console.log(`[CampaignWorker] Worker stopped (status: ${c.status}): ${campaignId}`);
        return true;
      }
      return false;
    };

    const { sentPhoneDigits, failedSends } = await sendFirstMessageOnlyWithStore(
      users,
      { messageTemplates: appConfig.messageTemplates },
      {
        greenApi,
        greenInstanceDbId,
        messageDelayMs,
        stableCampaignId,
        pauseCheck,
      },
      state,
      '',
      {
        shouldSkipUser() {
          // Disabled skip logic for campaigns (allow resend)
          if (false) {
            return true;
          }
          return false;
        },
      },
    );

    const sentSet = new Set(sentPhoneDigits);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < contacts.length; i += 1) {
      const c = contacts[i];
      const u = users[i];
      if (sentSet.has(c.phoneNormalized)) {
        await markContactSent(Number(c.id));
        sent += 1;
        continue;
      }
      if (firstMessageEmpty(u)) {
        await markContactSkipped(Number(c.id), 'Empty or invalid first message / sequence');
        skipped += 1;
        continue;
      }
      const apiErr = failedSends && failedSends[c.phoneNormalized];
      await markContactFailed(Number(c.id), apiErr || 'Send failed');
      failed += 1;
    }

    console.log(
      `[CampaignWorker] Batch ${batchNum} counts: sent=${sent}, failed=${failed}, skipped=${skipped} (batchSize=${contacts.length})`,
    );
    await incrementSentCount(campaignId, sent);
    await incrementFailedCount(campaignId, failed);
    await incrementSkippedCount(campaignId, skipped);

    const afterBatch = await getCampaignById(campaignId);
    if (!afterBatch) return;
    if (afterBatch.status === 'paused') {
      console.log(`[CampaignWorker] Campaign ${campaignId} paused (after batch)`);
      return;
    }
    if (afterBatch.status !== 'running') {
      console.log(`[CampaignWorker] Campaign ${campaignId} stopped after batch (status: ${afterBatch.status})`);
      return;
    }

    if (delaySeconds > 0) {
      await sleep(delaySeconds * 1000);
    }
  }
}

module.exports = { runCampaignWorker };
