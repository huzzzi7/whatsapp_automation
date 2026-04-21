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
const { createLogger } = require('../utils/logger');

function parsePayload(payloadJson, log) {
  if (payloadJson == null || payloadJson === '') return {};
  try {
    const s = typeof payloadJson === 'string' ? payloadJson : String(payloadJson);
    const obj = JSON.parse(s);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    log.warn({ err: e.message, event: 'invalid_payload_json' }, 'Invalid payload_json, using empty object');
    return {};
  }
}

function contactsToUsers(contacts, log) {
  return contacts.map((c) => {
    const base = parsePayload(c.payloadJson, log);
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

  const greenInstanceDbId = campaign.greenInstanceId;

  const [instRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [
    greenInstanceDbId,
  ]);
  const instRow = instRows[0];
  if (!instRow) {
    throw new Error(`Green instance not found for campaign: ${greenInstanceDbId}`);
  }

  const greenApi = resolveGreenApiConfig(instRow);
  const stableCampaignId = `campaign-${campaignId}`;
  const campLog = createLogger('worker', { campaignId: stableCampaignId, greenInstanceDbId });

  let batchNum = 0;

  while (true) {
    const current = await getCampaignById(campaignId);
    if (!current) {
      throw new Error(`Campaign disappeared: ${campaignId}`);
    }

    if (current.status === 'paused') {
      campLog.info({ event: 'campaign_worker_paused', phase: 'before_batch' }, 'paused (before batch)');
      return;
    }
    if (current.status !== 'running') {
      if (current.status === 'stopped') {
        campLog.info({ event: 'campaign_stopped_by_user', phase: 'before_batch' }, 'Campaign stopped by user');
      }
      campLog.info({ event: 'campaign_worker_stopped', status: current.status }, `stopped (status: ${current.status})`);
      return;
    }

    const batchSize = Math.max(1, Number(current.batchSize) || 20);

    const contacts = await getPendingContacts(campaignId, batchSize);

    if (contacts.length === 0) {
      await updateCampaignStatus(campaignId, 'completed');
      campLog.info({ event: 'campaign_completed' }, 'completed');
      break;
    }

    batchNum += 1;
    campLog.info({ event: 'campaign_batch_start', batchNum, recipients: contacts.length }, `batch ${batchNum} start`);

    const users = contactsToUsers(contacts, campLog);

    const pauseCheck = async () => {
      const c = await getCampaignById(campaignId);
      if (!c) return true;
      if (c.status === 'paused') {
        campLog.info({ event: 'campaign_worker_paused', phase: 'mid_batch' }, 'pause (mid-batch)');
        return true;
      }
      if (c.status !== 'running') {
        if (c.status === 'stopped') {
          campLog.info({ event: 'campaign_stopped_by_user', phase: 'mid_batch' }, 'Campaign stopped by user (mid-batch)');
        }
        campLog.info({ event: 'campaign_worker_stopped_mid_batch', status: c.status }, `stopped mid-batch (status: ${c.status})`);
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

    campLog.info(
      { event: 'campaign_batch_done', batchNum, sent, failed, skipped, batchSize: contacts.length },
      `batch ${batchNum} done`,
    );
    await incrementSentCount(campaignId, sent);
    await incrementFailedCount(campaignId, failed);
    await incrementSkippedCount(campaignId, skipped);

    const afterBatch = await getCampaignById(campaignId);
    if (!afterBatch) return;
    if (afterBatch.status === 'paused') {
      campLog.info({ event: 'campaign_worker_paused', phase: 'after_batch' }, 'paused (after batch)');
      return;
    }
    if (afterBatch.status !== 'running') {
      if (afterBatch.status === 'stopped') {
        campLog.info({ event: 'campaign_stopped_by_user', phase: 'after_batch' }, 'Campaign stopped by user (after batch)');
      }
      campLog.info(
        { event: 'campaign_worker_stopped_after_batch', status: afterBatch.status },
        `stopped after batch (status: ${afterBatch.status})`,
      );
      return;
    }
  }
}

module.exports = { runCampaignWorker };
