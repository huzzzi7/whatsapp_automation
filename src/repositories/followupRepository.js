/**
 * Phase 6 — follow-up job audit table access.
 */
const pool = require('../mysql');

async function insertQueuedJob({ greenInstanceDbId, phoneNormalized, campaignId, step, dueAt }) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phoneNormalized || '').trim();
  if (!gid || !p) return { insertId: 0, affectedRows: 0 };
  const s = Math.max(1, Math.floor(Number(step) || 1));
  const rawDue = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const due = !Number.isNaN(rawDue.getTime()) ? rawDue : new Date();
  const cid = campaignId != null && String(campaignId).trim() !== '' ? String(campaignId).slice(0, 255) : null;

  const [result] = await pool.execute(
    `INSERT IGNORE INTO followup_jobs
      (green_instance_db_id, phone_normalized, campaign_id, step, due_at)
     VALUES (?, ?, ?, ?, ?)`,
    [gid, p, cid, s, due],
  );
  return {
    insertId: Number(result?.insertId) || 0,
    affectedRows: Number(result?.affectedRows) || 0,
  };
}

async function markEnqueued(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return;
  await pool.execute('UPDATE followup_jobs SET enqueued_at = NOW(3) WHERE id = ?', [Math.floor(n)]);
}

async function markSent(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return;
  await pool.execute("UPDATE followup_jobs SET status = 'sent', sent_at = NOW(3) WHERE id = ?", [Math.floor(n)]);
}

async function markFailed(id, error) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return;
  const msg = error != null ? String(error).slice(0, 65535) : 'failed';
  await pool.execute("UPDATE followup_jobs SET status = 'failed', last_error = ? WHERE id = ?", [msg, Math.floor(n)]);
}

async function cancelPendingForConversation(greenInstanceDbId, phoneNormalized) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phoneNormalized || '').trim();
  if (!gid || !p) return;
  await pool.execute(
    `UPDATE followup_jobs
     SET status = 'cancelled', cancelled_at = NOW(3)
     WHERE green_instance_db_id = ? AND phone_normalized = ?
       AND status IN ('queued', 'failed')`,
    [gid, p],
  );
}

module.exports = {
  insertQueuedJob,
  markEnqueued,
  markSent,
  markFailed,
  cancelPendingForConversation,
};

