/**
 * DB access for campaigns and campaign_contacts (queue + execution tracking).
 */
const pool = require('../mysql');
const { normalizePhone } = require('../phone');
const appConfig = require('../../config');

const BATCH_INSERT_SIZE = 500;

function mapCampaignRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    greenInstanceId: row.green_instance_id,
    name: row.name,
    status: row.status,
    queueOrder: row.queue_order,
    totalContacts: row.total_contacts,
    sentCount: row.sent_count,
    failedOrSkippedCount: row.failed_or_skipped_count,
    failedCount:
      row.failed_count != null && row.failed_count !== undefined
        ? Number(row.failed_count) || 0
        : Number(row.failed_or_skipped_count) || 0,
    skippedCount:
      row.skipped_count != null && row.skipped_count !== undefined ? Number(row.skipped_count) || 0 : 0,
    batchSize: row.batch_size,
    delaySeconds: row.delay_seconds,
    messageDelaySeconds: row.message_delay_seconds,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    scheduledAt: row.scheduled_at ?? null,
  };
}

/**
 * @param {{ id: string, greenInstanceId: string, name?: string|null, batchSize: number, delaySeconds: number, messageDelaySeconds: number, totalContacts: number, queueOrder: number, scheduledAt?: Date|string|null }} params
 */
async function createCampaign({
  id,
  greenInstanceId,
  name = null,
  batchSize,
  delaySeconds,
  messageDelaySeconds,
  totalContacts,
  queueOrder,
  scheduledAt = null,
}) {
  let sched = null;
  if (scheduledAt != null) {
    const d = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    if (!Number.isNaN(d.getTime())) sched = d;
  }
  await pool.execute(
    `INSERT INTO campaigns (
      id, green_instance_id, name, status, queue_order, total_contacts,
      batch_size, delay_seconds, message_delay_seconds, scheduled_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      greenInstanceId,
      name == null || name === '' ? null : String(name).slice(0, 255),
      queueOrder,
      totalContacts,
      batchSize,
      delaySeconds,
      messageDelaySeconds,
      sched,
    ],
  );
  const [rows] = await pool.execute('SELECT * FROM campaigns WHERE id = ? LIMIT 1', [id]);
  return mapCampaignRow(rows[0]);
}

/**
 * Next queue_order for new campaigns (global FIFO).
 */
async function getNextQueueOrder() {
  const [rows] = await pool.execute('SELECT COALESCE(MAX(queue_order), 0) AS n FROM campaigns');
  const n = rows[0]?.n;
  return (Number(n) || 0) + 1;
}

/**
 * @param {string} campaignId
 * @param {Array<object>} users - raw user objects from API (phone, university, sequence, …)
 */
/**
 * @returns {Promise<number>} number of rows inserted
 */
async function insertCampaignContacts(campaignId, users) {
  const list = Array.isArray(users) ? users : [];
  const rows = [];
  const seenPhones = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const user = list[i];
    const phoneRaw = user?.phone != null ? String(user.phone).trim() : '';
    const phoneNormalized =
      normalizePhone(phoneRaw, appConfig.defaultCountryCode) || String(phoneRaw).replace(/\D/g, '');
    if (!phoneNormalized) continue;
    if (seenPhones.has(phoneNormalized)) continue;
    seenPhones.add(phoneNormalized);
    rows.push({
      phoneNormalized,
      payloadJson: JSON.stringify(user ?? {}),
      sortOrder: rows.length,
    });
  }
  for (let offset = 0; offset < rows.length; offset += BATCH_INSERT_SIZE) {
    const slice = rows.slice(offset, offset + BATCH_INSERT_SIZE);
    const placeholders = slice.map(() => '(?, ?, ?, ?)').join(', ');
    const values = [];
    for (const r of slice) {
      values.push(campaignId, r.phoneNormalized, r.payloadJson, r.sortOrder);
    }
    await pool.execute(
      `INSERT INTO campaign_contacts (campaign_id, phone_normalized, payload_json, sort_order) VALUES ${placeholders}`,
      values,
    );
  }
  return rows.length;
}

async function setTotalContacts(campaignId, totalContacts) {
  const n = Math.max(0, Math.floor(Number(totalContacts) || 0));
  await pool.execute(
    `UPDATE campaigns SET total_contacts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [n, campaignId],
  );
}

async function getNextQueuedCampaign() {
  const [rows] = await pool.execute(
    `SELECT * FROM campaigns WHERE status = 'queued'
     AND (scheduled_at IS NULL OR scheduled_at <= UTC_TIMESTAMP())
     ORDER BY queue_order ASC, created_at ASC LIMIT 1`,
  );
  return mapCampaignRow(rows[0]);
}

/**
 * Atomically promote queued → running only if still queued and schedule is due in DB (UTC).
 * @returns {Promise<number>} affectedRows (1 if this worker claimed the campaign)
 */
async function promoteQueuedCampaignToRunningIfDue(campaignId) {
  const [result] = await pool.execute(
    `UPDATE campaigns
     SET status = 'running', error_message = NULL, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status = 'queued'
       AND (scheduled_at IS NULL OR scheduled_at <= UTC_TIMESTAMP())`,
    [campaignId],
  );
  return Number(result.affectedRows) || 0;
}

async function getRunningCampaign() {
  const [rows] = await pool.execute(
    `SELECT * FROM campaigns WHERE status = 'running' ORDER BY started_at ASC LIMIT 1`,
  );
  return mapCampaignRow(rows[0]);
}

async function getPausedCampaigns() {
  const [rows] = await pool.execute(
    `SELECT * FROM campaigns WHERE status = 'paused' ORDER BY updated_at DESC`,
  );
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

async function getQueuedCampaigns() {
  const [rows] = await pool.execute(
    `SELECT * FROM campaigns WHERE status = 'queued' ORDER BY queue_order ASC, created_at ASC`,
  );
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

const LISTABLE_STATUSES = new Set(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled']);

/**
 * @param {{ statuses?: string[] }} [opts] - if empty/omitted, all campaigns
 * @returns {Promise<object[]>} mapped campaign rows
 */
async function listCampaigns(opts = {}) {
  const { statuses } = opts;
  if (statuses && Array.isArray(statuses) && statuses.length > 0) {
    const safe = [...new Set(statuses.map((s) => String(s || '').trim().toLowerCase()).filter((s) => LISTABLE_STATUSES.has(s)))];
    if (safe.length === 0) {
      return [];
    }
    const ph = safe.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `SELECT * FROM campaigns WHERE status IN (${ph}) ORDER BY created_at DESC`,
      safe,
    );
    return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
  }
  const [rows] = await pool.execute('SELECT * FROM campaigns ORDER BY created_at DESC');
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

/**
 * Last N contacts by primary key (recent rows) for debugging / detail view.
 */
async function getCampaignContactsSample(campaignId, limit = 20) {
  const lim = Math.max(1, Math.min(10000, Math.floor(Number(limit) || 1)));
  const [rows] = await pool.execute(
    `SELECT id, phone_normalized, first_send_status, sort_order, sent_at, last_error, attempt_count
     FROM campaign_contacts
     WHERE campaign_id = ?
     ORDER BY id DESC
     LIMIT ${lim}`,
    [campaignId],
  );
  return rows;
}

async function countCampaignContacts(campaignId) {
  const [[row]] = await pool.execute(
    'SELECT COUNT(*) AS cnt FROM campaign_contacts WHERE campaign_id = ?',
    [campaignId],
  );
  return Number(row?.cnt) || 0;
}

/**
 * Paginated contacts in send order (sort_order, id).
 * @param {string} campaignId
 * @param {number} page - 1-based
 * @param {number} limit - clamped 1..200
 */
async function listCampaignContactsPage(campaignId, page, limit) {
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const pg = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (pg - 1) * lim;
  const [rows] = await pool.execute(
    `SELECT id, phone_normalized, first_send_status, sort_order, sent_at, last_error, attempt_count
     FROM campaign_contacts
     WHERE campaign_id = ?
     ORDER BY sort_order ASC, id ASC
     LIMIT ${lim} OFFSET ${offset}`,
    [campaignId],
  );
  return rows;
}

/**
 * @param {string} campaignId
 * @param {string} status - queued | running | paused | completed | failed | cancelled
 * @param {{ errorMessage?: string }} [opts]
 */
async function updateCampaignStatus(campaignId, status, opts = {}) {
  const err = opts.errorMessage != null ? String(opts.errorMessage).slice(0, 65535) : null;

  if (status === 'running') {
    await pool.execute(
      `UPDATE campaigns SET status = ?, error_message = NULL, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, campaignId],
    );
  } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    await pool.execute(
      `UPDATE campaigns SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, err, campaignId],
    );
  } else if (status === 'paused' || status === 'queued') {
    await pool.execute(
      `UPDATE campaigns SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, err, campaignId],
    );
  } else {
    await pool.execute(
      `UPDATE campaigns SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, err, campaignId],
    );
  }
}

async function incrementSentCount(campaignId, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return;
  await pool.execute(
    `UPDATE campaigns SET sent_count = sent_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [n, campaignId],
  );
}

async function incrementFailedCount(campaignId, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return;
  await pool.execute(
    `UPDATE campaigns SET failed_count = failed_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [n, campaignId],
  );
}

async function incrementSkippedCount(campaignId, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return;
  await pool.execute(
    `UPDATE campaigns SET skipped_count = skipped_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [n, campaignId],
  );
}

async function getPendingContacts(campaignId, limit) {
  const lim = Math.max(1, Math.min(10000, Math.floor(Number(limit) || 1)));
  const [rows] = await pool.execute(
    `SELECT id, campaign_id, phone_normalized, payload_json, sort_order, first_send_status, attempt_count, last_error, sent_at
     FROM campaign_contacts
     WHERE campaign_id = ? AND first_send_status = 'pending'
     ORDER BY sort_order ASC
     LIMIT ${lim}`,
    [campaignId],
  );
  return rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    phoneNormalized: row.phone_normalized,
    payloadJson: row.payload_json,
    sortOrder: row.sort_order,
    firstSendStatus: row.first_send_status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    sentAt: row.sent_at,
  }));
}

async function markContactSent(contactId) {
  await pool.execute(
    `UPDATE campaign_contacts SET first_send_status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [contactId],
  );
}

async function markContactFailed(contactId, lastError) {
  const msg = lastError != null ? String(lastError).slice(0, 65535) : 'failed';
  await pool.execute(
    `UPDATE campaign_contacts SET first_send_status = 'failed', last_error = ?, attempt_count = attempt_count + 1 WHERE id = ?`,
    [msg, contactId],
  );
}

async function markContactSkipped(contactId, reason) {
  const msg = reason != null ? String(reason).slice(0, 65535) : 'skipped';
  await pool.execute(
    `UPDATE campaign_contacts SET first_send_status = 'skipped', last_error = ?, attempt_count = attempt_count + 1 WHERE id = ?`,
    [msg, contactId],
  );
}

async function getCampaignById(campaignId) {
  const [rows] = await pool.execute('SELECT * FROM campaigns WHERE id = ? LIMIT 1', [campaignId]);
  return mapCampaignRow(rows[0]);
}

module.exports = {
  createCampaign,
  getNextQueueOrder,
  insertCampaignContacts,
  setTotalContacts,
  getNextQueuedCampaign,
  promoteQueuedCampaignToRunningIfDue,
  getRunningCampaign,
  getPausedCampaigns,
  getQueuedCampaigns,
  listCampaigns,
  getCampaignContactsSample,
  updateCampaignStatus,
  incrementSentCount,
  incrementFailedCount,
  incrementSkippedCount,
  getPendingContacts,
  markContactSent,
  markContactFailed,
  markContactSkipped,
  getCampaignById,
  countCampaignContacts,
  listCampaignContactsPage,
};
