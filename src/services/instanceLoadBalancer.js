const pool = require('../mysql');
const { countRemainingOperationalDays } = require('../utils/remainingOperationalDays');

/**
 * Returns all active green_instances from DB ordered by createdAt ASC
 */
async function getAvailableInstances() {
  const [rows] = await pool.execute(
    'SELECT * FROM green_instances WHERE isActive = 1 AND manualDisabled = 0 ORDER BY createdAt ASC'
  );
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

function toIsoDateString(input) {
  if (input == null || String(input).trim() === '') return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    const yyyy = input.getUTCFullYear();
    const mm = String(input.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(input.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const s = String(input).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/**
 * Given:
 * - totalContacts: number
 * - instances: array of instance rows
 * - campaignStartDate: Date|string|null (first day; null → today)
 * - campaignEndDate: Date|string (last day inclusive)
 * - operationalDays: string e.g. "1,2,3,4,5" (0=Sun, 1=Mon...6=Sat)
 * - operationalEnd: string HH:MM (optional; falls back to env/default)
 *
 * Returns: dailyLimitPerInstance (integer, minimum 1)
 */
async function calculateDailyLimit(
  totalContacts,
  instances,
  campaignStartDate,
  campaignEndDate,
  operationalDays,
  operationalEnd,
) {
  const total = Math.max(0, Math.floor(Number(totalContacts) || 0));
  const instCount = Array.isArray(instances) ? instances.length : 0;
  if (instCount <= 0) return 1;

  const tz = process.env.CAMPAIGN_TIMEZONE || 'Europe/London';
  const endStr = toIsoDateString(campaignEndDate);
  if (!endStr) return Math.max(1, Math.ceil(total / instCount));

  const startStr = toIsoDateString(campaignStartDate);
  const remainingDays = countRemainingOperationalDays(
    startStr,
    endStr,
    operationalDays,
    Date.now(),
    tz,
    operationalEnd,
  );

  const totalDailyMessages = Math.ceil(total / remainingDays);
  const perInstanceDaily = Math.ceil(totalDailyMessages / instCount);
  return Math.max(1, perInstanceDaily);
}

module.exports = { getAvailableInstances, assignContactsToInstances, calculateDailyLimit };
