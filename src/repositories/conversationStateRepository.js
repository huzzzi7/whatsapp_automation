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
  // Phase 6 — follow-up metadata (all optional for backward compatibility)
  out.lastOutboundAt = row.last_outbound_at ? new Date(row.last_outbound_at).getTime() : null;
  out.lastInboundAt = row.last_inbound_at ? new Date(row.last_inbound_at).getTime() : null;
  out.followupStep = row.followup_step ?? 0;
  out.followupNextAt = row.followup_next_at ? new Date(row.followup_next_at).getTime() : null;
  out.followupCancelled = Boolean(row.followup_cancelled);
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
            last_outbound_at, last_inbound_at, followup_step, followup_next_at, followup_cancelled
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
  const hasFollowupStep = Object.prototype.hasOwnProperty.call(data, 'followupStep');
  const hasFollowupNextAt = Object.prototype.hasOwnProperty.call(data, 'followupNextAt');
  const hasFollowupCancelled = Object.prototype.hasOwnProperty.call(data, 'followupCancelled');
  const hasFollowupMeta =
    hasLastOutboundAt || hasLastInboundAt || hasFollowupStep || hasFollowupNextAt || hasFollowupCancelled;

  const lastOutboundAt =
    hasLastOutboundAt && data.lastOutboundAt != null && Number.isFinite(Number(data.lastOutboundAt))
      ? new Date(Number(data.lastOutboundAt))
      : null;
  const lastInboundAt =
    hasLastInboundAt && data.lastInboundAt != null && Number.isFinite(Number(data.lastInboundAt))
      ? new Date(Number(data.lastInboundAt))
      : null;
  const followupStep =
    hasFollowupStep && Number.isFinite(Number(data.followupStep)) ? Math.max(0, Math.floor(Number(data.followupStep))) : 0;
  const followupNextAt =
    hasFollowupNextAt && data.followupNextAt != null && Number.isFinite(Number(data.followupNextAt))
      ? new Date(Number(data.followupNextAt))
      : null;
  const followupCancelled =
    hasFollowupCancelled ? (data.followupCancelled ? 1 : 0) : 0;

  if (hasStatusKey && hasFollowupMeta) {
    await pool.execute(
      `INSERT INTO conversation_state (
        green_instance_db_id,
        phone_normalized,
        last_sent_index,
        campaign_id,
        sequence_json,
        status,
        last_outbound_at,
        last_inbound_at,
        followup_step,
        followup_next_at,
        followup_cancelled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        last_sent_index = VALUES(last_sent_index),
        campaign_id = VALUES(campaign_id),
        sequence_json = VALUES(sequence_json),
        status = VALUES(status),
        last_outbound_at = VALUES(last_outbound_at),
        last_inbound_at = VALUES(last_inbound_at),
        followup_step = VALUES(followup_step),
        followup_next_at = VALUES(followup_next_at),
        followup_cancelled = VALUES(followup_cancelled)`,
      [
        gid,
        p,
        lastSent,
        campaignId,
        JSON.stringify(seq),
        status,
        lastOutboundAt,
        lastInboundAt,
        followupStep,
        followupNextAt,
        followupCancelled,
      ],
    );
  } else if (!hasStatusKey && hasFollowupMeta) {
    await pool.execute(
      `INSERT INTO conversation_state (
        green_instance_db_id,
        phone_normalized,
        last_sent_index,
        campaign_id,
        sequence_json,
        status,
        last_outbound_at,
        last_inbound_at,
        followup_step,
        followup_next_at,
        followup_cancelled
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        last_sent_index = VALUES(last_sent_index),
        campaign_id = VALUES(campaign_id),
        sequence_json = VALUES(sequence_json),
        last_outbound_at = VALUES(last_outbound_at),
        last_inbound_at = VALUES(last_inbound_at),
        followup_step = VALUES(followup_step),
        followup_next_at = VALUES(followup_next_at),
        followup_cancelled = VALUES(followup_cancelled)`,
      [
        gid,
        p,
        lastSent,
        campaignId,
        JSON.stringify(seq),
        lastOutboundAt,
        lastInboundAt,
        followupStep,
        followupNextAt,
        followupCancelled,
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
}

async function updateOutboundMeta(greenInstanceDbId, phoneNormalized, opts) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phoneNormalized || '').trim();
  if (!gid || !p) return;
  const ms = Number(opts?.lastOutboundAt);
  const dt = Number.isFinite(ms) ? new Date(ms) : null;
  const hasFollowupNextAt = Object.prototype.hasOwnProperty.call(opts || {}, 'followupNextAt');
  const nextMs = Number(opts?.followupNextAt);
  const nextDt = hasFollowupNextAt && Number.isFinite(nextMs) ? new Date(nextMs) : null;

  if (hasFollowupNextAt) {
    await pool.execute(
      `UPDATE conversation_state
       SET last_outbound_at = ?, followup_next_at = ?, updated_at = NOW(3)
       WHERE green_instance_db_id = ? AND phone_normalized = ?`,
      [dt, nextDt, gid, p],
    );
    return;
  }

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

async function setFollowupState(greenInstanceDbId, phoneNormalized, { followupStep, followupNextAt, followupCancelled }) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phoneNormalized || '').trim();
  if (!gid || !p) return;
  const step = Math.max(0, Math.floor(Number(followupStep) || 0));
  const nextMs = followupNextAt == null ? null : Number(followupNextAt);
  const nextDt = nextMs != null && Number.isFinite(nextMs) ? new Date(nextMs) : null;
  const cancelled = followupCancelled ? 1 : 0;
  await pool.execute(
    `UPDATE conversation_state
     SET followup_step = ?, followup_next_at = ?, followup_cancelled = ?
     WHERE green_instance_db_id = ? AND phone_normalized = ?`,
    [step, nextDt, cancelled, gid, p],
  );
}

async function listEligibleForFollowup({ now, limit = 50 }) {
  const lim = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const rawDt = now instanceof Date ? now : new Date(now);
  const dt = !Number.isNaN(rawDt.getTime()) ? rawDt : new Date();
  const [rows] = await pool.execute(
    `SELECT green_instance_db_id, phone_normalized, campaign_id,
            followup_step, followup_next_at, last_outbound_at
     FROM conversation_state
     WHERE (status IS NULL OR status = 'active')
       AND followup_cancelled = 0
       AND followup_step < 3
       AND last_outbound_at IS NOT NULL
       AND (last_inbound_at IS NULL OR last_inbound_at < last_outbound_at)
       AND (followup_next_at IS NULL OR followup_next_at <= ?)
     ORDER BY followup_next_at ASC
     LIMIT ${lim}`,
    [dt],
  );
  return rows;
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
  setFollowupState,
  listEligibleForFollowup,
};
