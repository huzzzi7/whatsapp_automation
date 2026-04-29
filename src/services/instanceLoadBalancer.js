const pool = require('../mysql');

/**
 * Returns all active green_instances from DB ordered by createdAt ASC
 */
async function getAvailableInstances() {
  const [rows] = await pool.execute('SELECT * FROM green_instances ORDER BY createdAt ASC');
  return Array.isArray(rows) ? rows : [];
}

/**
 * Given total number of contacts and available instances,
 * returns array of { instance, contactCount, dailyLimit } assignments.
 *
 * Algorithm:
 * - Get all instances from DB
 * - Split contacts evenly: Math.ceil(totalContacts / instanceCount) per instance
 * - If only 1 instance: all contacts go to it
 * - Returns [] if no instances available (caller should error)
 */
async function assignContactsToInstances(totalContacts) {
  const instances = await getAvailableInstances();
  const total = Math.max(0, Math.floor(Number(totalContacts) || 0));
  if (!instances.length) return [];
  if (instances.length === 1) {
    return [{ instance: instances[0], contactCount: total, dailyLimit: null }];
  }
  const per = Math.ceil(total / instances.length);
  return instances.map((inst) => ({ instance: inst, contactCount: per, dailyLimit: null }));
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

function weekdayIndexInTz(now, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[name] ?? null;
}

function hhmmToMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
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

function addDaysYmd({ y, mo, d }, add) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + add);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function parseEndDate(campaignEndDate) {
  if (campaignEndDate instanceof Date) {
    const t = campaignEndDate.getTime();
    if (!Number.isNaN(t)) return new Date(t);
    return null;
  }
  const s = String(campaignEndDate || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Given:
 * - totalContacts: number
 * - instances: array of instance rows
 * - campaignEndDate: Date (last day of campaign)
 * - operationalDays: string e.g. "1,2,3,4,5" (0=Sun, 1=Mon...6=Sat)
 * - operationalEnd: string HH:MM (optional; falls back to env/default)
 *
 * Returns: dailyLimitPerInstance (integer, minimum 1)
 */
async function calculateDailyLimit(totalContacts, instances, campaignEndDate, operationalDays, operationalEnd) {
  const total = Math.max(0, Math.floor(Number(totalContacts) || 0));
  const instCount = Array.isArray(instances) ? instances.length : 0;
  if (instCount <= 0) return 1;

  const tz = process.env.CAMPAIGN_TIMEZONE || 'Europe/London';
  const end = parseEndDate(campaignEndDate);
  if (!end) return Math.max(1, Math.ceil(total / instCount));

  const daysSet = parseOperationalDaysMask(operationalDays);

  const now = new Date();
  const nowParts = tzWallParts(now.getTime(), tz);
  const endParts = tzWallParts(end.getTime(), tz);

  const endUtcStartOfDay = tzWallToUtcMs({ y: endParts.y, mo: endParts.mo, d: endParts.d, h: 0, mi: 0 }, tz);
  const nowUtcStartOfDay = tzWallToUtcMs({ y: nowParts.y, mo: nowParts.mo, d: nowParts.d, h: 0, mi: 0 }, tz);
  if (endUtcStartOfDay == null || nowUtcStartOfDay == null) return Math.max(1, Math.ceil(total / instCount));
  if (endUtcStartOfDay < nowUtcStartOfDay) return Math.max(1, Math.ceil(total / instCount));

  const resolvedOperationalEnd = operationalEnd || process.env.CAMPAIGN_OPERATIONAL_END || '21:00';
  const endMins = hhmmToMinutes(resolvedOperationalEnd) ?? 21 * 60;
  const nowMins = (Number(nowParts.h) || 0) * 60 + (Number(nowParts.mi) || 0);
  const todayDow = weekdayIndexInTz(now, tz);

  let remainingDays = 0;
  for (let i = 0; i <= 400; i += 1) {
    const dateParts = addDaysYmd({ y: nowParts.y, mo: nowParts.mo, d: nowParts.d }, i);
    const utcStart = tzWallToUtcMs({ ...dateParts, h: 0, mi: 0 }, tz);
    if (utcStart == null) continue;
    if (utcStart > endUtcStartOfDay) break;

    const day = new Date(utcStart);
    const dow = weekdayIndexInTz(day, tz);
    if (dow == null) continue;
    if (!daysSet.has(dow)) continue;

    if (i === 0) {
      if (todayDow != null && daysSet.has(todayDow) && nowMins < endMins) {
        remainingDays += 1;
      }
      continue;
    }

    remainingDays += 1;
  }

  if (remainingDays <= 0) remainingDays = 1;

  const totalDailyMessages = Math.ceil(total / remainingDays);
  const perInstanceDaily = Math.ceil(totalDailyMessages / instCount);
  return Math.max(1, perInstanceDaily);
}

module.exports = { getAvailableInstances, assignContactsToInstances, calculateDailyLimit };

