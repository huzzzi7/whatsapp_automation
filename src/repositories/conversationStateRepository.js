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
  out.lastOutboundAt = row.last_outbound_at ? new Date(row.last_outbound_at).getTime() : null;
  out.lastInboundAt = row.last_inbound_at ? new Date(row.last_inbound_at).getTime() : null;

  let recentInbound = [];
  if (row.inbound_history_json != null && String(row.inbound_history_json).trim() !== '') {
    try {
      const h = JSON.parse(row.inbound_history_json);
      if (Array.isArray(h)) {
        recentInbound = h.filter((x) => typeof x === 'string').slice(-3);
      }
    } catch {
      recentInbound = [];
    }
  }
  out.recentInbound = recentInbound;
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
    `SELECT last_sent_index, campaign_id, sequence_json, status,
            last_outbound_at, last_inbound_at, inbound_history_json
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

  const hasLastOutboundAt = Object.prototype.hasOwnProperty.call(data, 'lastOutboundAt');
  const hasLastInboundAt = Object.prototype.hasOwnProperty.call(data, 'lastInboundAt');
  const hasMeta = hasLastOutboundAt || hasLastInboundAt;

  const lastOutboundAt =
    hasLastOutboundAt && data.lastOutboundAt != null && Number.isFinite(Number(data.lastOutboundAt))
      ? new Date(Number(data.lastOutboundAt))
      : null;
  const lastInboundAt =
    hasLastInboundAt && data.lastInboundAt != null && Number.isFinite(Number(data.lastInboundAt))
      ? new Date(Number(data.lastInboundAt))
      : null;

  if (hasStatusKey && hasMeta) {
    await pool.execute(
      `INSERT INTO conversation_state (
        green_instance_db_id,
        phone_normalized,
        last_sent_index,
        campaign_id,
        sequence_json,
        status,
        last_outbound_at,
        last_inbound_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        last_sent_index = VALUES(last_sent_index),
        campaign_id = VALUES(campaign_id),
        sequence_json = VALUES(sequence_json),
        status = VALUES(status),
        last_outbound_at = VALUES(last_outbound_at),
        last_inbound_at = VALUES(last_inbound_at)`,
      [
        gid,
        p,
        lastSent,
        campaignId,
        JSON.stringify(seq),
        status,
        lastOutboundAt,
        lastInboundAt,
      ],
    );
  } else if (!hasStatusKey && hasMeta) {
    await pool.execute(
      `INSERT INTO conversation_state (
        green_instance_db_id,
        phone_normalized,
        last_sent_index,
        campaign_id,
        sequence_json,
        status,
        last_outbound_at,
        last_inbound_at
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      ON DUPLICATE KEY UPDATE
        last_sent_index = VALUES(last_sent_index),
        campaign_id = VALUES(campaign_id),
        sequence_json = VALUES(sequence_json),
        last_outbound_at = VALUES(last_outbound_at),
        last_inbound_at = VALUES(last_inbound_at)`,
      [
        gid,
        p,
        lastSent,
        campaignId,
        JSON.stringify(seq),
        lastOutboundAt,
        lastInboundAt,
      ],
    );
  } else if (hasStatusKey) {
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

  if (Object.prototype.hasOwnProperty.call(data, 'recentInbound') && Array.isArray(data.recentInbound)) {
    const hist = JSON.stringify(data.recentInbound.filter((x) => typeof x === 'string').slice(-3));
    await pool.execute(
      `UPDATE conversation_state
       SET inbound_history_json = ?, updated_at = NOW(3)
       WHERE green_instance_db_id = ? AND phone_normalized = ?`,
      [hist, gid, p],
    );
  }
}

/**
 * Append one inbound message to a ring buffer (max 3) in conversation_state.
 * @param {string} greenInstanceDbId
 * @param {string} phoneNormalized
 * @param {string} newText
 */
async function appendInboundHistory(greenInstanceDbId, phoneNormalized, newText) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phoneNormalized || '').trim();
  if (!gid || !p) return;
  const piece = String(newText ?? '');
  const [rows] = await pool.execute(
    `SELECT inbound_history_json FROM conversation_state
     WHERE green_instance_db_id = ? AND phone_normalized = ?
     LIMIT 1`,
    [gid, p],
  );
  let arr = [];
  const cell = rows[0]?.inbound_history_json;
  if (cell != null && String(cell).trim() !== '') {
    try {
      const parsed = JSON.parse(String(cell));
      if (Array.isArray(parsed)) arr = parsed.filter((x) => typeof x === 'string');
    } catch {
      arr = [];
    }
  }
  arr.push(piece);
  if (arr.length > 3) arr = arr.slice(-3);
  const json = JSON.stringify(arr);
  await pool.execute(
    `UPDATE conversation_state
     SET inbound_history_json = ?, updated_at = NOW(3)
     WHERE green_instance_db_id = ? AND phone_normalized = ?`,
    [json, gid, p],
  );
}

async function updateOutboundMeta(greenInstanceDbId, phoneNormalized, opts) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phoneNormalized || '').trim();
  if (!gid || !p) return;
  const ms = Number(opts?.lastOutboundAt);
  const dt = Number.isFinite(ms) ? new Date(ms) : null;

  await pool.execute(
    `UPDATE conversation_state
     SET last_outbound_at = ?, updated_at = NOW(3)
     WHERE green_instance_db_id = ? AND phone_normalized = ?`,
    [dt, gid, p],
  );
}

async function updateInboundMeta(greenInstanceDbId, phoneNormalized, { lastInboundAt }) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phoneNormalized || '').trim();
  if (!gid || !p) return;
  const ms = Number(lastInboundAt);
  const dt = Number.isFinite(ms) ? new Date(ms) : null;
  await pool.execute(
    `UPDATE conversation_state
     SET last_inbound_at = ?, updated_at = NOW(3)
     WHERE green_instance_db_id = ? AND phone_normalized = ?`,
    [dt, gid, p],
  );
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
  updateOutboundMeta,
  updateInboundMeta,
  appendInboundHistory,
};
