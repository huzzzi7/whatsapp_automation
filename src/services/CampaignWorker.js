/**
 * Campaign execution: send Meta template messages per contact.
 */
const {
  getCampaignById,
  getPendingContacts,
  getDailyContactsSentCount,
  markContactSent,
  markContactFailed,
  incrementSentCount,
  incrementFailedCount,
  updateCampaignStatus,
  countPendingContacts,
} = require('../repositories/campaignRepository');
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { getMetaTemplateById } = require('../repositories/metaTemplateRepository');
const { sendMetaTemplateBatch } = require('./metaCampaignSend');
const { createLogger } = require('../utils/logger');

function sleepMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

function hhmmToMinutes(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim().slice(0, 5));
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

const MAX_SPREAD_MS = 30 * 60 * 1000;

function computeSpreadDelayMs({
  operationalStart,
  operationalEnd,
  timeZone,
  effectiveDailyLimit,
  sentToday,
  paceMs,
  nowMs,
}) {
  if (effectiveDailyLimit == null || effectiveDailyLimit === 0) {
    return paceMs;
  }

  const remainingTodayMessages = Math.max(1, effectiveDailyLimit - sentToday);
  if (remainingTodayMessages <= 0) {
    return paceMs;
  }

  const tz = timeZone || 'Europe/London';
  const nowParts = tzWallParts(nowMs, tz);
  const startMins = hhmmToMinutes(operationalStart, 9 * 60);
  const endMins = hhmmToMinutes(operationalEnd, 21 * 60);
  const startH = Math.floor(startMins / 60);
  const startMi = startMins % 60;
  const endH = Math.floor(endMins / 60);
  const endMi = endMins % 60;

  const operationalStartMs = tzWallToUtcMs(
    { y: nowParts.y, mo: nowParts.mo, d: nowParts.d, h: startH, mi: startMi },
    tz,
  );
  const operationalEndMs = tzWallToUtcMs(
    { y: nowParts.y, mo: nowParts.mo, d: nowParts.d, h: endH, mi: endMi },
    tz,
  );

  if (operationalStartMs == null || operationalEndMs == null) {
    return paceMs;
  }

  const operationalWindowMs = operationalEndMs - operationalStartMs;
  const elapsedMs = Math.max(0, nowMs - operationalStartMs);
  const remainingWindowMs = Math.max(0, operationalWindowMs - elapsedMs);

  if (remainingWindowMs <= 0) {
    return paceMs;
  }

  const rawSpread = Math.floor(remainingWindowMs / remainingTodayMessages);
  const spreadDelayMs = Math.min(rawSpread, MAX_SPREAD_MS);
  return Math.max(paceMs, spreadDelayMs);
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

function normalizeIsoDate(value) {
  if (value == null || String(value).trim() === '') return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function msUntilCampaignStartDate(campaignStartDate, operationalStart, timeZone) {
  const tz = timeZone || 'Europe/London';
  const startIso = normalizeIsoDate(campaignStartDate);
  if (!startIso) return 0;

  const now = new Date();
  const todayIso = dateStringInTz(now, tz);
  if (todayIso >= startIso) return 0;

  const [y, mo, d] = startIso.split('-').map(Number);
  const startMins = hhmmToMinutes(operationalStart, 9 * 60);
  const startH = Math.floor(startMins / 60);
  const startMi = startMins % 60;
  const utcStart = tzWallToUtcMs({ y, mo, d, h: startH, mi: startMi }, tz);
  if (utcStart == null) return 5 * 60 * 1000;
  const delta = utcStart - now.getTime();
  return delta > 0 ? delta : 0;
}

async function sleepInChunks(totalMs, chunkMs = 12 * 60 * 60 * 1000) {
  let remaining = Math.max(0, Math.floor(Number(totalMs) || 0));
  const chunk = Math.max(1000, Math.floor(Number(chunkMs) || 1000));
  while (remaining > 0) {
    const step = Math.min(remaining, chunk);
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

async function exitIfCampaignNotRunningAfterSleep(campaignId, campLog, sleptMs, phase) {
  const ms = Number(sleptMs) || 0;
  if (ms <= 30000) return false;
  const fresh = await getCampaignById(campaignId);
  if (!fresh) return true;
  if (fresh.status !== 'running') {
    if (fresh.status === 'paused') {
      campLog.info({ event: 'campaign_worker_paused', phase }, 'paused after long sleep');
    } else {
      campLog.info(
        { event: 'campaign_worker_stopped_after_sleep', status: fresh.status, phase },
        'campaign no longer running after long sleep',
      );
    }
    return true;
  }
  return false;
}

async function runCampaignWorker(campaignId) {
  const campaign = await getCampaignById(campaignId);
  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  const metaConfig = await getMetaConfigRow();
  if (!metaConfig || !metaConfig.isEnabled) {
    throw new Error('Meta config not found or disabled');
  }
  const metaTemplate = await getMetaTemplateById(campaign.metaTemplateId);
  if (!metaTemplate) {
    throw new Error(`Meta template not found for campaign: ${campaign.metaTemplateId}`);
  }

  const operationalStart = campaign.operationalStart || process.env.CAMPAIGN_OPERATIONAL_START || '09:00';
  const operationalEnd = campaign.operationalEnd || process.env.CAMPAIGN_OPERATIONAL_END || '21:00';
  const operationalDays = campaign.operationalDays || '1,2,3,4,5';
  const campaignStartDate = campaign.campaignStartDate ?? null;
  const campaignEndDate = campaign.campaignEndDate ?? null;
  const dailyLimitPerInstance =
    campaign.dailyLimitPerInstance != null && Number.isFinite(Number(campaign.dailyLimitPerInstance))
      ? Math.max(1, Math.floor(Number(campaign.dailyLimitPerInstance)))
      : null;
  const timeZone = process.env.CAMPAIGN_TIMEZONE || 'Europe/London';

  const campLog = createLogger('worker', { campaignId });

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

    const todayIso = dateStringInTz(new Date(), timeZone);
    const endIso = normalizeIsoDate(current.campaignEndDate ?? campaignEndDate);
    if (endIso && todayIso > endIso) {
      campLog.info(
        { event: 'campaign_end_date_passed', todayIso, endIso },
        'campaign end date passed; marking completed',
      );
      await updateCampaignStatus(campaignId, 'completed');
      return;
    }

    const startIso = normalizeIsoDate(current.campaignStartDate ?? campaignStartDate);
    if (startIso && todayIso < startIso) {
      const msUntilStart = msUntilCampaignStartDate(startIso, operationalStart, timeZone);
      const sleepFor = Math.min(Math.max(msUntilStart, 1000), 5 * 60 * 1000);
      campLog.info(
        { event: 'campaign_before_start_date', todayIso, startIso, sleepMs: sleepFor },
        'before campaign start date, waiting',
      );
      await sleepMs(sleepFor);
      if (await exitIfCampaignNotRunningAfterSleep(campaignId, campLog, sleepFor, 'before_start_date')) {
        return;
      }
      continue;
    }

    if (!isWithinOperationalHours(operationalStart, operationalEnd, operationalDays, timeZone)) {
      const msUntil = msUntilNextOperationalStart(operationalStart, operationalDays, timeZone);
      const sleepFor = Math.min(msUntil, 5 * 60 * 1000);
      campLog.info(
        { event: 'campaign_outside_operational_hours', sleepMs: sleepFor, timeZone, operationalStart, operationalEnd, operationalDays },
        'outside operational hours, pausing until next window',
      );
      await sleepMs(sleepFor);
      if (await exitIfCampaignNotRunningAfterSleep(campaignId, campLog, sleepFor, 'after_operational_sleep')) {
        return;
      }
      continue;
    }

    const effectiveDailyLimit =
      current.dailyLimitPerInstance != null && Number.isFinite(Number(current.dailyLimitPerInstance))
        ? Math.max(1, Math.floor(Number(current.dailyLimitPerInstance)))
        : dailyLimitPerInstance;

    let sentToday = 0;
    if (effectiveDailyLimit != null) {
      const today = dateStringInTz(new Date(), timeZone);
      sentToday = await getDailyContactsSentCount(campaignId, today);
      if (sentToday >= effectiveDailyLimit) {
        const msUntil = msUntilNextOperationalStart(operationalStart, operationalDays, timeZone);
        campLog.info(
          {
            event: 'campaign_daily_limit_reached',
            today,
            sentToday,
            dailyLimitPerInstance: effectiveDailyLimit,
            sleepMs: msUntil,
          },
          'daily limit reached; sleeping until next operational start',
        );
        await sleepInChunks(msUntil, 12 * 60 * 60 * 1000);
        if (await exitIfCampaignNotRunningAfterSleep(campaignId, campLog, msUntil, 'after_daily_limit_sleep')) {
          return;
        }
        continue;
      }
    }

    const batchSize = 1;

    if (batchNum > 0) {
      const msPerWindow = Math.max(1000, parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10));
      const maxPerWindow = Math.max(1, parseInt(process.env.RATE_LIMIT_MESSAGES_PER_WINDOW || '1', 10));
      const paceMs = Math.floor(msPerWindow / maxPerWindow);
      const spreadDelayMs = computeSpreadDelayMs({
        operationalStart,
        operationalEnd,
        timeZone,
        effectiveDailyLimit,
        sentToday,
        paceMs,
        nowMs: Date.now(),
      });
      campLog.info(
        { event: 'campaign_pace_delay', paceMs, spreadDelayMs, msPerWindow, maxPerWindow },
        `pacing: even-spread delay ${spreadDelayMs}ms (pace floor ${paceMs}ms)`,
      );
      await sleepMs(spreadDelayMs);
      if (await exitIfCampaignNotRunningAfterSleep(campaignId, campLog, spreadDelayMs, 'after_pace_sleep')) {
        return;
      }
    }

    const contacts = await getPendingContacts(campaignId, batchSize);

    if (contacts.length === 0) {
      const globalPending = await countPendingContacts(campaignId);
      if (globalPending > 0) {
        campLog.info(
          { event: 'campaign_done_waiting', globalPending },
          'no pending work in batch; contacts still pending globally',
        );
        break;
      }
      await updateCampaignStatus(campaignId, 'completed');
      campLog.info({ event: 'campaign_completed' }, 'completed');
      break;
    }

    batchNum += 1;
    campLog.info({ event: 'campaign_batch_start', batchNum, recipients: contacts.length }, `batch ${batchNum} start`);

    const users = contactsToUsers(contacts, campLog);

    const { sentPhoneDigits, failedSends, sentMessageIds } = await sendMetaTemplateBatch(users, { metaConfig, metaTemplate });

    const sentSet = new Set(sentPhoneDigits);

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < contacts.length; i += 1) {
      const c = contacts[i];
      if (sentSet.has(c.phoneNormalized)) {
        await markContactSent(Number(c.id), sentMessageIds?.[c.phoneNormalized]);
        sent += 1;
        continue;
      }
      const apiErr = failedSends && failedSends[c.phoneNormalized];
      await markContactFailed(Number(c.id), apiErr || 'Send failed');
      failed += 1;
    }

    campLog.info(
      { event: 'campaign_batch_done', batchNum, sent, failed, batchSize: contacts.length },
      `batch ${batchNum} done`,
    );
    await incrementSentCount(campaignId, sent);
    await incrementFailedCount(campaignId, failed);

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
