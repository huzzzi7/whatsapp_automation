/**
 * DB access for opted_out_contacts — permanent WhatsApp messaging suppression list.
 */
const pool = require('../mysql');

/**
 * @param {string} phoneNormalized
 * @param {'button'|'keyword'} source
 * @returns {Promise<void>}
 */
async function addOptOut(phoneNormalized, source) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return;
  const src = source === 'button' ? 'button' : 'keyword';
  await pool.execute(
    `INSERT INTO opted_out_contacts (phone_normalized, source) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE phone_normalized = phone_normalized`,
    [phone, src],
  );
}

/**
 * @param {string} phoneNormalized
 * @returns {Promise<number>} affected rows (1 if removed, 0 if not present)
 */
async function removeOptOut(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return 0;
  const [result] = await pool.execute('DELETE FROM opted_out_contacts WHERE phone_normalized = ?', [phone]);
  return Number(result.affectedRows) || 0;
}

/**
 * @param {string} phoneNormalized
 * @returns {Promise<boolean>}
 */
async function isOptedOut(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return false;
  const [rows] = await pool.execute(
    'SELECT 1 FROM opted_out_contacts WHERE phone_normalized = ? LIMIT 1',
    [phone],
  );
  return rows.length > 0;
}

/**
 * Bulk check for filtering an upload batch efficiently (single query instead of N).
 * @param {string[]} phoneNumbers
 * @returns {Promise<Set<string>>} the subset of phoneNumbers that are opted out
 */
async function filterOptedOut(phoneNumbers) {
  const list = [...new Set((phoneNumbers || []).map((p) => String(p || '').trim()).filter(Boolean))];
  if (!list.length) return new Set();
  const ph = list.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT phone_normalized FROM opted_out_contacts WHERE phone_normalized IN (${ph})`,
    list,
  );
  return new Set(rows.map((r) => String(r.phone_normalized)));
}

/**
 * @returns {Promise<Array<{ phoneNormalized: string, optedOutAt: Date, source: string }>>}
 */
async function listOptedOut() {
  const [rows] = await pool.execute(
    'SELECT phone_normalized, opted_out_at, source FROM opted_out_contacts ORDER BY opted_out_at DESC',
  );
  return rows.map((r) => ({
    phoneNormalized: r.phone_normalized,
    optedOutAt: r.opted_out_at,
    source: r.source,
  }));
}

module.exports = { addOptOut, removeOptOut, isOptedOut, filterOptedOut, listOptedOut };
