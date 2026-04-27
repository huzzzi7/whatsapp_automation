/**
 * Phase 5 — DB access for warmup_* tables.
 */
const pool = require('../mysql');

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    messagesPerPair: Number(row.messages_per_pair) || 10,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    stoppedAt: row.stopped_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

function mapPair(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    senderInstanceDbId: row.sender_instance_db_id,
    receiverInstanceDbId: row.receiver_instance_db_id,
    templateId: Number(row.template_id),
    status: row.status,
    messagesSent: Number(row.messages_sent) || 0,
    messagesTarget: Number(row.messages_target) || 10,
    lastMessageAt: row.last_message_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTemplate(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    templateIndex: Number(row.template_index),
    templateName: row.template_name,
    messagesJson: row.messages_json,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createSession(id, messagesPerPair) {
  const mpp = Math.max(1, Math.floor(Number(messagesPerPair) || 10));
  await pool.execute(
    `INSERT INTO warmup_sessions (id, status, messages_per_pair) VALUES (?, 'running', ?)`,
    [id, mpp],
  );
  const [rows] = await pool.execute('SELECT * FROM warmup_sessions WHERE id = ? LIMIT 1', [id]);
  return mapSession(rows[0]);
}

/**
 * @param {Array<{id:string, sessionId:string, senderInstanceDbId:string, receiverInstanceDbId:string, templateId:number, messagesTarget:number}>} pairs
 */
async function createPairs(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (list.length === 0) return 0;
  const placeholders = list.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const values = [];
  for (const p of list) {
    values.push(
      p.id,
      p.sessionId,
      p.senderInstanceDbId,
      p.receiverInstanceDbId,
      Number(p.templateId),
      'pending',
      0,
      Math.max(1, Math.floor(Number(p.messagesTarget) || 10)),
    );
  }
  const [result] = await pool.execute(
    `INSERT INTO warmup_pairs (
      id, session_id, sender_instance_db_id, receiver_instance_db_id, template_id, status, messages_sent, messages_target
    ) VALUES ${placeholders}`,
    values,
  );
  return Number(result.affectedRows) || 0;
}

async function getSessionById(id) {
  const [rows] = await pool.execute('SELECT * FROM warmup_sessions WHERE id = ? LIMIT 1', [id]);
  return mapSession(rows[0]);
}

async function getActiveSession() {
  const [rows] = await pool.execute(
    `SELECT * FROM warmup_sessions WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`,
  );
  return mapSession(rows[0]);
}

async function getPairsBySession(sessionId) {
  const [rows] = await pool.execute(
    `SELECT * FROM warmup_pairs WHERE session_id = ? ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(mapPair).filter(Boolean);
}

async function getPendingPairs(sessionId) {
  const [rows] = await pool.execute(
    `SELECT * FROM warmup_pairs WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(mapPair).filter(Boolean);
}

async function getPairById(pairId) {
  const [rows] = await pool.execute(`SELECT * FROM warmup_pairs WHERE id = ? LIMIT 1`, [pairId]);
  return rows[0] || null;
}

async function updatePairStatus(pairId, status, extra = {}) {
  const err = extra.errorMessage != null ? String(extra.errorMessage).slice(0, 65535) : null;
  await pool.execute(
    `UPDATE warmup_pairs SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [String(status), err, pairId],
  );
}

async function incrementPairMessagesSent(pairId) {
  await pool.execute(
    `UPDATE warmup_pairs
     SET messages_sent = messages_sent + 1, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [pairId],
  );
}

async function insertWarmupMessage(data) {
  const {
    pairId,
    sessionId,
    senderInstanceDbId,
    receiverInstanceDbId,
    role,
    messageText,
    messageIndex,
  } = data || {};

  const r = String(role || '').toUpperCase() === 'B' ? 'B' : 'A';
  const idx = Math.max(0, Math.floor(Number(messageIndex) || 0));
  const text = String(messageText || '').slice(0, 65535);

  const [result] = await pool.execute(
    `INSERT INTO warmup_messages (
      pair_id, session_id, sender_instance_db_id, receiver_instance_db_id,
      role, message_text, message_index, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')`,
    [pairId, sessionId, senderInstanceDbId, receiverInstanceDbId, r, text, idx],
  );
  return Number(result.insertId);
}

async function updateMessageStatus(id, status, extra = {}) {
  const err = extra.errorMessage != null ? String(extra.errorMessage).slice(0, 65535) : null;
  if (String(status) === 'sent') {
    await pool.execute(
      `UPDATE warmup_messages SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ?`,
      [Number(id)],
    );
    return;
  }
  if (String(status) === 'failed') {
    await pool.execute(
      `UPDATE warmup_messages SET status = 'failed', error_message = ? WHERE id = ?`,
      [err || 'failed', Number(id)],
    );
    return;
  }
  await pool.execute(`UPDATE warmup_messages SET status = ? WHERE id = ?`, [String(status), Number(id)]);
}

async function updateSessionStatus(id, status, extra = {}) {
  const err = extra.errorMessage != null ? String(extra.errorMessage).slice(0, 65535) : null;
  const s = String(status);
  if (s === 'completed') {
    await pool.execute(
      `UPDATE warmup_sessions SET status = 'completed', completed_at = CURRENT_TIMESTAMP, error_message = NULL WHERE id = ?`,
      [id],
    );
    return;
  }
  if (s === 'failed') {
    await pool.execute(
      `UPDATE warmup_sessions SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?`,
      [err || 'failed', id],
    );
    return;
  }
  if (s === 'stopped') {
    await pool.execute(
      `UPDATE warmup_sessions SET status = 'stopped', stopped_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
    );
    return;
  }
  await pool.execute(`UPDATE warmup_sessions SET status = ? WHERE id = ?`, [s, id]);
}

async function getSessionStats(sessionId) {
  const [pairRows] = await pool.execute(
    `SELECT
       COUNT(*) AS pairsTotal,
       SUM(status='completed') AS pairsCompleted,
       SUM(status='failed') AS pairsFailed,
       SUM(status IN ('pending','running')) AS pairsActive,
       SUM(messages_sent) AS messagesSent,
       SUM(messages_target) AS messagesTarget
     FROM warmup_pairs
     WHERE session_id = ?`,
    [sessionId],
  );
  const row = pairRows[0] || {};
  return {
    pairsTotal: Number(row.pairsTotal) || 0,
    pairsCompleted: Number(row.pairsCompleted) || 0,
    pairsFailed: Number(row.pairsFailed) || 0,
    pairsActive: Number(row.pairsActive) || 0,
    messagesSent: Number(row.messagesSent) || 0,
    messagesTarget: Number(row.messagesTarget) || 0,
  };
}

async function getActiveTemplates() {
  const [rows] = await pool.execute(
    `SELECT * FROM warmup_templates WHERE is_active = 1 ORDER BY template_index ASC`,
  );
  return rows.map(mapTemplate).filter(Boolean);
}

async function getTemplateById(id) {
  const [rows] = await pool.execute(`SELECT * FROM warmup_templates WHERE id = ? LIMIT 1`, [Number(id)]);
  return mapTemplate(rows[0]);
}

async function getAllTemplates() {
  const [rows] = await pool.execute(`SELECT * FROM warmup_templates ORDER BY template_index ASC`);
  return rows.map(mapTemplate).filter(Boolean);
}

async function getMessageById(id) {
  const [rows] = await pool.execute(
    `SELECT id, status, error_message, sent_at FROM warmup_messages WHERE id = ? LIMIT 1`,
    [Number(id)],
  );
  return rows[0] || null;
}

module.exports = {
  createSession,
  createPairs,
  getSessionById,
  getActiveSession,
  getPairsBySession,
  getPendingPairs,
  getPairById,
  updatePairStatus,
  incrementPairMessagesSent,
  insertWarmupMessage,
  updateMessageStatus,
  updateSessionStatus,
  getSessionStats,
  getActiveTemplates,
  getTemplateById,
  getAllTemplates,
  getMessageById,
};

