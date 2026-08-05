/**
 * DB access for pending_university_requests — tiny piece of conversation state: tracks that a
 * contact tapped "Different uni" and we're now awaiting their free-text answer.
 */
const pool = require('../mysql');

/** @returns {Promise<boolean>} true if a pending request already exists for this phone */
async function hasPendingUniversityRequest(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return false;
  const [rows] = await pool.execute(
    'SELECT 1 FROM pending_university_requests WHERE phone_normalized = ? LIMIT 1',
    [phone],
  );
  return rows.length > 0;
}

async function setPendingUniversityRequest(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return;
  await pool.execute(
    `INSERT INTO pending_university_requests (phone_normalized) VALUES (?)
     ON DUPLICATE KEY UPDATE requested_at = CURRENT_TIMESTAMP`,
    [phone],
  );
}

async function clearPendingUniversityRequest(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return;
  await pool.execute('DELETE FROM pending_university_requests WHERE phone_normalized = ?', [phone]);
}

module.exports = { hasPendingUniversityRequest, setPendingUniversityRequest, clearPendingUniversityRequest };
