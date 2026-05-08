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
  getDailyContactsSentCount,
  markContactSent,
  markContactFailed,
  markContactSkipped,
  incrementSentCount,
  incrementFailedCount,
  incrementSkippedCount,
  updateCampaignStatus,
} = require('../repositories/campaignRepository');
const { createLogger } = require('../utils/logger');

function sleepMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

function hhmmToMinutes(hhmm, fallback) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return fallback;
  return h * 60 + mi;
}

function weekdayIndexInTz(date, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[name] ?? null;
}

function tzWallParts(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const o = {};
  for (const p of parts) {
    if (p.type !== 'literal') o[p.type] = +p.value;
  }
  return { y: o.year, mo: o.month, d: o.day, h: o.hour, mi: o.minute };
}

function tzWallToUtcMs({ y, mo, d, h, mi }, timeZone) {
  const anchor = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const windowMs = 40 * 60 * 60 * 1000;
  const step = 60 * 1000;
  for (let delta = -windowMs; delta <= windowMs; delta += step) {
    const t = anchor + delta;
    const p = tzWallParts(t, timeZone);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) return t;
  }
  return null;
}

function parseOperationalDaysMask(operationalDays) {
  const raw = String(operationalDays || '').trim();
  if (!raw) return new Set([1, 2, 3, 4, 5]);
  const set = new Set();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const n = Number(part);
    if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
  }
  return set;
}

function isWithinOperationalHours(operationalStart, operationalEnd, operationalDays, timeZone) {
  const tz = timeZone || 'Europe/London';
  const now = new Date();
  const parts = tzWallParts(now.getTime(), tz);
  const mins = (Number(parts.h) || 0) * 60 + (Number(parts.mi) || 0);

  const startMins = hhmmToMinutes(operationalStart, 9 * 60);
  const endMins = hhmmToMinutes(operationalEnd, 21 * 60);

  const dow = weekdayIndexInTz(now, tz);
  const daysSet = parseOperationalDaysMask(operationalDays);
  if (dow == null || !daysSet.has(dow)) return false;

  if (mins < startMins) return false;
  if (mins > endMins) return false;
  return true;
}

function msUntilNextOperationalStart(operationalStart, operationalDays, timeZone) {
  const tz = timeZone || 'Europe/London';
  const now = new Date();
  const nowParts = tzWallParts(now.getTime(), tz);
  const startMins = hhmmToMinutes(operationalStart, 9 * 60);
  const startH = Math.floor(startMins / 60);
  const startMi = startMins % 60;
  const daysSet = parseOperationalDaysMask(operationalDays);

  for (let add = 0; add <= 14; add += 1) {
    const dt = new Date(Date.UTC(nowParts.y, nowParts.mo - 1, nowParts.d));
    dt.setUTCDate(dt.getUTCDate() + add);
    const wall = tzWallParts(dt.getTime(), tz);
    const utcStart = tzWallToUtcMs(
      { y: wall.y, mo: wall.mo, d: wall.d, h: startH, mi: startMi },
      tz,
    );
    if (utcStart == null) continue;
    const dow = weekdayIndexInTz(new Date(utcStart), tz);
    if (dow == null || !daysSet.has(dow)) continue;
    if (utcStart <= now.getTime()) continue;
    return utcStart - now.getTime();
  }
  return 5 * 60 * 1000;
}

function dateStringInTz(date, timeZone) {
  const tz = timeZone || 'Europe/London';
  const p = tzWallParts(date.getTime(), tz);
  const mm = String(p.mo).padStart(2, '0');
  const dd = String(p.d).padStart(2, '0');
  return `${p.y}-${mm}-${dd}`;
}

async function sleepInChunks(totalMs, chunkMs = 12 * 60 * 60 * 1000) {
  let remaining = Math.max(0, Math.floor(Number(totalMs) || 0));
  const chunk = Math.max(1000, Math.floor(Number(chunkMs) || 1000));
  while (remaining > 0) {
    const step = Math.min(remaining, chunk);
    // eslint-disable-next-line no-await-in-loop
    await sleepMs(step);
    remaining -= step;
  }
}

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

async function runCampaignWorker(campaignId, opts = {}) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const workerInstanceId =
    opts.workerInstanceId != null && String(opts.workerInstanceId).trim() !== ''
      ? String(opts.workerInstanceId).trim()
      : null;
  const greenInstanceDbId = workerInstanceId || campaign.greenInstanceId;

  const operationalStart = campaign.operationalStart || process.env.CAMPAIGN_OPERATIONAL_START || '09:00';
  const operationalEnd = campaign.operationalEnd || process.env.CAMPAIGN_OPERATIONAL_END || '21:00';
  const operationalDays = campaign.operationalDays || '1,2,3,4,5';
  const dailyLimitPerInstance =
    campaign.dailyLimitPerInstance != null && Number.isFinite(Number(campaign.dailyLimitPerInstance))
      ? Math.max(1, Math.floor(Number(campaign.dailyLimitPerInstance)))
      : null;
  const isMultiInstance = Boolean(campaign.isMultiInstance);
  const timeZone = process.env.CAMPAIGN_TIMEZONE || 'Europe/London';

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

    if (!isWithinOperationalHours(operationalStart, operationalEnd, operationalDays, timeZone)) {
      const msUntil = msUntilNextOperationalStart(operationalStart, operationalDays, timeZone);
      const sleepFor = Math.min(msUntil, 5 * 60 * 1000);
      campLog.info(
        { event: 'campaign_outside_operational_hours', sleepMs: sleepFor, timeZone, operationalStart, operationalEnd, operationalDays },
        'outside operational hours, pausing until next window',
      );
      // eslint-disable-next-line no-await-in-loop
      await sleepMs(sleepFor);
      continue;
    }

    const effectiveDailyLimit =
      current.dailyLimitPerInstance != null && Number.isFinite(Number(current.dailyLimitPerInstance))
        ? Math.max(1, Math.floor(Number(current.dailyLimitPerInstance)))
        : dailyLimitPerInstance;

    if (effectiveDailyLimit != null) {
      const today = dateStringInTz(new Date(), timeZone);
      const sentToday = await getDailyContactsSentCount(campaignId, greenInstanceDbId, today);
      if (sentToday >= effectiveDailyLimit) {
        // Sleep until tomorrow's next operational start in the operational timezone.
        const msUntil = msUntilNextOperationalStart(operationalStart, operationalDays, timeZone);
        campLog.info(
          {
            event: 'campaign_daily_limit_reached',
            greenInstanceDbId,
            today,
            sentToday,
            dailyLimitPerInstance: effectiveDailyLimit,
            sleepMs: msUntil,
          },
          'daily limit reached for instance today; sleeping until next operational start',
        );
        // eslint-disable-next-line no-await-in-loop
        await sleepInChunks(msUntil, 12 * 60 * 60 * 1000);
        continue;
      }
    }

    // Always process 1 contact per loop iteration.
    // The inter-message delay (CAMPAIGN_INTER_MESSAGE_DELAY_MS) in replyFlow.js controls pace.
    // batchSize from DB is intentionally ignored — rate is controlled by .env settings only.
    const batchSize = 1;

    // Rate-pacing: wait before fetching+sending each contact.
    // Formula: windowMs / maxPerWindow = ms per message per instance.
    // Example: 60000ms / 1 msg = 60s between sends. Set RATE_LIMIT_MESSAGES_PER_WINDOW=1, RATE_LIMIT_WINDOW_MS=60000.
    if (batchNum > 0) {
      const msPerWindow = Math.max(1000, parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10));
      const maxPerWindow = Math.max(1, parseInt(process.env.RATE_LIMIT_MESSAGES_PER_WINDOW || '1', 10));
      const paceMs = Math.floor(msPerWindow / maxPerWindow);
      campLog.info(
        { event: 'campaign_pace_delay', paceMs, msPerWindow, maxPerWindow },
        `pacing: waiting ${paceMs}ms before next contact`,
      );
      await sleepMs(paceMs);
    }

    const contacts = isMultiInstance
      ? await getPendingContacts(campaignId, batchSize, greenInstanceDbId)
      : await getPendingContacts(campaignId, batchSize);

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
