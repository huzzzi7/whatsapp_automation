/**
 * MySQL-backed conversation state (dual-write phase with conversation-state.json).
 */
const pool = require('../mysql');

function mapRow(row) {
  if (!row) return null;
  let sequence = row.sequence_json;
  if (typeof sequence === 'string') {
    try {
      sequence = JSON.parse(sequence);
    } catch {
      sequence = [];
    }
  }
  if (!Array.isArray(sequence)) sequence = [];
  const out = {
    lastSentIndex: Number(row.last_sent_index) || 0,
    sequence,
    campaignId: row.campaign_id != null ? String(row.campaign_id) : undefined,
  };
  if (row.status != null && String(row.status).trim() !== '') {
    out.status = String(row.status).trim();
  }
  return out;
}

/**
 * @param {string} instanceId - green_instances.id
 * @param {string} phone - normalized digits
 */
async function getState(instanceId, phone) {
  const gid = String(instanceId || '').trim();
  const p = String(phone || '').trim();
  if (!gid || !p) return null;
  const [rows] = await pool.execute(
    `SELECT last_sent_index, campaign_id, sequence_json, status
     FROM conversation_state
     WHERE green_instance_db_id = ? AND phone_normalized = ?
     LIMIT 1`,
    [gid, p],
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * @param {string} instanceId
 * @param {string} phone
 * @param {{ lastSentIndex: number, sequence: string[], campaignId?: string, status?: string|null }} data
 */
async function upsertState(instanceId, phone, data) {
  const gid = String(instanceId || '').trim();
  const p = String(phone || '').trim();
  if (!gid || !p) return;
  const seq = Array.isArray(data.sequence) ? data.sequence : [];
  const campaignId = data.campaignId != null ? String(data.campaignId).slice(0, 255) : null;
  const lastSent = Math.floor(Number(data.lastSentIndex) || 0);
  const hasStatusKey = Object.prototype.hasOwnProperty.call(data, 'status');
  const status = hasStatusKey
    ? data.status != null && String(data.status).trim() !== ''
      ? String(data.status).trim().slice(0, 32)
      : null
    : null;

  if (hasStatusKey) {
    await pool.execute(
      `INSERT INTO conversation_state (
        green_instance_db_id,
        phone_normalized,
        last_sent_index,
        campaign_id,
        sequence_json,
        status
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        last_sent_index = VALUES(last_sent_index),
        campaign_id = VALUES(campaign_id),
        sequence_json = VALUES(sequence_json),
        status = VALUES(status)`,
      [gid, p, lastSent, campaignId, JSON.stringify(seq), status],
    );
  } else {
    await pool.execute(
      `INSERT INTO conversation_state (
        green_instance_db_id,
        phone_normalized,
        last_sent_index,
        campaign_id,
        sequence_json,
        status
      ) VALUES (?, ?, ?, ?, ?, NULL)
      ON DUPLICATE KEY UPDATE
        last_sent_index = VALUES(last_sent_index),
        campaign_id = VALUES(campaign_id),
        sequence_json = VALUES(sequence_json)`,
      [gid, p, lastSent, campaignId, JSON.stringify(seq)],
    );
  }
}

/**
 * Optimistic lock: advance last_sent_index only if it still matches expectedIndex.
 * @param {string} instanceId
 * @param {string} phone
 * @param {number} newIndex
 * @param {number} expectedIndex
 * @returns {Promise<{ success: boolean }>}
 */
async function updateLastSent(instanceId, phone, newIndex, expectedIndex) {
  const gid = String(instanceId || '').trim();
  const p = String(phone || '').trim();
  if (!gid || !p) return { success: false };
  const newIdx = Math.floor(Number(newIndex) || 0);
  const expected = Math.floor(Number(expectedIndex) || 0);
  const [result] = await pool.execute(
    `UPDATE conversation_state
     SET last_sent_index = ?, updated_at = NOW(3)
     WHERE green_instance_db_id = ?
       AND phone_normalized = ?
       AND last_sent_index = ?`,
    [newIdx, gid, p, expected],
  );
  const affected = result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
  return { success: affected === 1 };
}

/**
 * Unconditional update (e.g. legacy sync state.updateLastSent / dual-write helpers).
 * @param {string} instanceId
 * @param {string} phone
 * @param {number} index
 */
async function updateLastSentUnconditional(instanceId, phone, index) {
  const gid = String(instanceId || '').trim();
  const p = String(phone || '').trim();
  if (!gid || !p) return;
  const idx = Math.floor(Number(index) || 0);
  await pool.execute(
    `UPDATE conversation_state SET last_sent_index = ?, updated_at = NOW(3) WHERE green_instance_db_id = ? AND phone_normalized = ?`,
    [idx, gid, p],
  );
}

/**
 * @param {string} instanceId
 * @param {string} phone
 */
async function deleteState(instanceId, phone) {
  const gid = String(instanceId || '').trim();
  const p = String(phone || '').trim();
  if (!gid || !p) return;
  await pool.execute(
    `DELETE FROM conversation_state WHERE green_instance_db_id = ? AND phone_normalized = ?`,
    [gid, p],
  );
}

module.exports = {
  getState,
  upsertState,
  updateLastSent,
  updateLastSentUnconditional,
  deleteState,
};
