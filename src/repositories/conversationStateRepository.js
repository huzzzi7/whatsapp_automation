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
  return {
    lastSentIndex: Number(row.last_sent_index) || 0,
    sequence,
    campaignId: row.campaign_id != null ? String(row.campaign_id) : undefined,
  };
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
    `SELECT last_sent_index, campaign_id, sequence_json
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
 * @param {{ lastSentIndex: number, sequence: string[], campaignId?: string }} data
 */
async function upsertState(instanceId, phone, data) {
  const gid = String(instanceId || '').trim();
  const p = String(phone || '').trim();
  if (!gid || !p) return;
  const seq = Array.isArray(data.sequence) ? data.sequence : [];
  const campaignId = data.campaignId != null ? String(data.campaignId).slice(0, 255) : null;
  const lastSent = Math.floor(Number(data.lastSentIndex) || 0);
  await pool.execute(
    `INSERT INTO conversation_state (
      green_instance_db_id,
      phone_normalized,
      last_sent_index,
      campaign_id,
      sequence_json
    ) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      last_sent_index = VALUES(last_sent_index),
      campaign_id = VALUES(campaign_id),
      sequence_json = VALUES(sequence_json)`,
    [gid, p, lastSent, campaignId, JSON.stringify(seq)],
  );
}

/**
 * @param {string} instanceId
 * @param {string} phone
 * @param {number} index
 */
async function updateLastSent(instanceId, phone, index) {
  const gid = String(instanceId || '').trim();
  const p = String(phone || '').trim();
  if (!gid || !p) return;
  const idx = Math.floor(Number(index) || 0);
  await pool.execute(
    `UPDATE conversation_state SET last_sent_index = ? WHERE green_instance_db_id = ? AND phone_normalized = ?`,
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
  deleteState,
};
