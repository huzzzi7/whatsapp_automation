/**
 * Unified remaining operational days counter (London TZ–aware).
 * Used by calculateDailyLimit, preview, PATCH recalc, and frontend estimates.
 */

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

function weekdayIndexInTz(date, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseIsoDateStr(str) {
  const s = String(str || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function isoDateFromWallParts({ y, mo, d }) {
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function addDaysToIso(iso, add) {
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + add);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * @param {string|null|undefined} startDateStr - YYYY-MM-DD (null → today in timezone)
 * @param {string|null|undefined} endDateStr - YYYY-MM-DD inclusive end
 * @param {string} operationalDaysMask - comma-separated DOW 0–6
 * @param {number} [nowMs] - current instant (default Date.now())
 * @param {string} [timezone] - IANA timezone (default Europe/London)
 * @param {string} [operationalEnd] - HH:MM; if today and now past this, skip today
 * @returns {number} remaining operational days, minimum 1
 */
function countRemainingOperationalDays(
  startDateStr,
  endDateStr,
  operationalDaysMask,
  nowMs,
  timezone,
  operationalEnd,
) {
  const tz = timezone || process.env.CAMPAIGN_TIMEZONE || 'Europe/London';
  const now = new Date(nowMs != null && Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now());
  const endIso = parseIsoDateStr(endDateStr);
  if (!endIso) return 1;

  const nowParts = tzWallParts(now.getTime(), tz);
  const todayIso = isoDateFromWallParts(nowParts);

  let loopStartIso = parseIsoDateStr(startDateStr) || todayIso;
  if (loopStartIso < todayIso) loopStartIso = todayIso;
  if (loopStartIso > endIso) return 1;

  const daysSet = parseOperationalDaysMask(operationalDaysMask);
  const resolvedEnd = operationalEnd || process.env.CAMPAIGN_OPERATIONAL_END || '21:00';
  const endMins = hhmmToMinutes(resolvedEnd) ?? 21 * 60;
  const nowMins = (Number(nowParts.h) || 0) * 60 + (Number(nowParts.mi) || 0);

  let count = 0;
  let cursor = loopStartIso;
  let guard = 0;
  while (cursor <= endIso && guard < 500) {
    guard += 1;
    const [y, mo, d] = cursor.split('-').map(Number);
    const utcNoon = tzWallToUtcMs({ y, mo, d, h: 12, mi: 0 }, tz);
    const dow = utcNoon != null ? weekdayIndexInTz(new Date(utcNoon), tz) : null;

    if (dow != null && daysSet.has(dow)) {
      const isToday = cursor === todayIso;
      if (!(isToday && nowMins >= endMins)) {
        count += 1;
      }
    }

    cursor = addDaysToIso(cursor, 1);
  }

  return Math.max(count, 1);
}

module.exports = { countRemainingOperationalDays };
module.exports.default = countRemainingOperationalDays;
Object.defineProperty(module.exports, '__esModule', { value: true });
