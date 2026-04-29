/**
 * Registers warmup schedule repeatable jobs on warmupQueue.
 */
const { warmupQueue } = require('./index');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

function parseHhMm(value, fallback) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return fallback;
  return { h, mi };
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

function localTimeToUtcCron(hhmm, timeZone) {
  const tz = timeZone || 'Europe/London';
  const fallback = { h: 7, mi: 0 };
  const parsed = parseHhMm(hhmm, fallback);
  const now = new Date();
  const nowParts = tzWallParts(now.getTime(), tz);
  const utcMs = tzWallToUtcMs(
    { y: nowParts.y, mo: nowParts.mo, d: nowParts.d, h: parsed.h, mi: parsed.mi },
    tz,
  );
  if (utcMs == null) {
    return { cron: `${parsed.mi} ${parsed.h} * * *`, utc: parsed, tz };
  }
  const d = new Date(utcMs);
  const utc = { h: d.getUTCHours(), mi: d.getUTCMinutes() };
  return { cron: `${utc.mi} ${utc.h} * * *`, utc, tz };
}

async function registerWarmupScheduleJobs() {
  const tz = process.env.CAMPAIGN_TIMEZONE || 'Europe/London';
  const morning = process.env.WARMUP_MORNING_TIME || '07:00';
  const evening = process.env.WARMUP_EVENING_TIME || '23:00';

  const morningCron = localTimeToUtcCron(morning, tz);
  const eveningCron = localTimeToUtcCron(evening, tz);

  const desired = [
    { name: 'warmup_morning', cron: morningCron.cron, meta: { local: morning, utc: morningCron.utc } },
    { name: 'warmup_evening', cron: eveningCron.cron, meta: { local: evening, utc: eveningCron.utc } },
  ];

  try {
    const repeatables = await warmupQueue.getRepeatableJobs();
    for (const r of repeatables) {
      const match = desired.find((d) => String(r.name) === d.name);
      if (match && r.key) {
        await warmupQueue.removeRepeatableByKey(r.key);
        log.info({ event: 'warmup_repeatable_removed', key: r.key, name: r.name }, 'removed prior warmup repeatable');
      }
    }
  } catch (err) {
    log.warn({ err: err?.message || String(err), event: 'warmup_repeatable_remove_failed' }, 'could not remove prior warmup repeatables (continuing)');
  }

  for (const j of desired) {
    await warmupQueue.add(
      j.name,
      { kind: j.name },
      {
        repeat: { pattern: j.cron },
        jobId: j.name,
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 },
        attempts: 1,
      },
    );
  }

  log.info(
    {
      event: 'warmup_schedule_registered',
      timeZone: tz,
      morningLocal: morning,
      eveningLocal: evening,
      morningUtcCron: morningCron.cron,
      eveningUtcCron: eveningCron.cron,
    },
    `Warmup scheduled at ${morning} and ${evening} ${tz}`,
  );
}

module.exports = { registerWarmupScheduleJobs };

