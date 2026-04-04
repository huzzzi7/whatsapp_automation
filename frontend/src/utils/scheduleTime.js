/**
 * Schedule helpers: datetime-local values are interpreted as Europe/London civil time, then converted to UTC ISO.
 */

const LONDON_TZ = 'Europe/London';

function londonWallParts(utcMs) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON_TZ,
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

function partsToDatetimeLocal(p) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Current instant formatted as `YYYY-MM-DDTHH:mm` for datetime-local (London wall clock). */
export function getCurrentLondonDatetimeLocalString() {
  return partsToDatetimeLocal(londonWallParts(Date.now()));
}

/**
 * Map a datetime-local string (no TZ) to UTC ISO, treating components as London civil time.
 * @param {string} localStr e.g. "2026-04-03T15:45"
 * @returns {string | null} ISO string or null if invalid / not found
 */
export function londonDatetimeLocalToUtcIso(localStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(localStr).trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = +m[4];
  const mi = +m[5];

  const anchor = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  const windowMs = 40 * 60 * 60 * 1000;
  const step = 60 * 1000;

  for (let delta = -windowMs; delta <= windowMs; delta += step) {
    const t = anchor + delta;
    const p = londonWallParts(t);
    if (p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi) {
      return new Date(t).toISOString();
    }
  }
  return null;
}
