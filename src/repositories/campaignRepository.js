/**
 * DB access for campaigns and campaign_contacts (queue + execution tracking).
 */
const pool = require('../mysql');
const { normalizePhone } = require('../phone');
const appConfig = require('../../config');
const { filterOptedOut } = require('./optOutRepository');

const BATCH_INSERT_SIZE = 500;

const CAMPAIGN_SELECT = `SELECT c.* FROM campaigns c`;

function toIsoDateStr(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    const s = val.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function mapCampaignRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider || 'meta',
    metaTemplateId: row.meta_template_id ?? null,
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
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    scheduledAt: row.scheduled_at ?? null,
    operationalStart: row.operational_start ?? null,
    operationalEnd: row.operational_end ?? null,
    operationalDays: row.operational_days ?? null,
    campaignStartDate: toIsoDateStr(row.campaign_start_date),
    campaignEndDate: toIsoDateStr(row.campaign_end_date),
    dailyLimitPerInstance: row.daily_limit_per_instance ?? null,
  };
}

async function createCampaign({
  id,
  metaTemplateId = null,
  name = null,
  batchSize,
  totalContacts,
  queueOrder,
  scheduledAt = null,
  operationalStart = null,
  operationalEnd = null,
  operationalDays = null,
  campaignStartDate = null,
  campaignEndDate = null,
  dailyLimitPerInstance = null,
}) {
  let sched = null;
  if (scheduledAt != null) {
    const d = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    if (!Number.isNaN(d.getTime())) sched = d;
  }

  const opStart =
    operationalStart != null && String(operationalStart).trim() !== ''
      ? String(operationalStart).trim().slice(0, 8)
      : null;
  const opEnd =
    operationalEnd != null && String(operationalEnd).trim() !== ''
      ? String(operationalEnd).trim().slice(0, 8)
      : null;
  const opDays =
    operationalDays != null && String(operationalDays).trim() !== ''
      ? String(operationalDays).trim().slice(0, 20)
      : null;
  const startDate =
    campaignStartDate != null && String(campaignStartDate).trim() !== ''
      ? String(campaignStartDate).trim().slice(0, 10)
      : null;
  const endDate =
    campaignEndDate != null && String(campaignEndDate).trim() !== ''
      ? String(campaignEndDate).trim().slice(0, 10)
      : null;
  const dailyLimit =
    dailyLimitPerInstance != null && Number.isFinite(Number(dailyLimitPerInstance))
      ? Math.max(1, Math.floor(Number(dailyLimitPerInstance)))
      : null;
  const metaTemplateIdValue =
    metaTemplateId != null && Number.isFinite(Number(metaTemplateId)) ? Number(metaTemplateId) : null;

  await pool.execute(
    `INSERT INTO campaigns (
      id, provider, meta_template_id, name, status, queue_order, total_contacts,
      batch_size, scheduled_at,
      operational_start, operational_end, operational_days, campaign_start_date, campaign_end_date,
      daily_limit_per_instance
    ) VALUES (?, 'meta', ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      metaTemplateIdValue,
      name == null || name === '' ? null : String(name).slice(0, 255),
      queueOrder,
      totalContacts,
      batchSize,
      sched,
      opStart,
      opEnd,
      opDays,
      startDate,
      endDate,
      dailyLimit,
    ],
  );
  const [rows] = await pool.execute('SELECT * FROM campaigns WHERE id = ? LIMIT 1', [id]);
  return mapCampaignRow(rows[0]);
}

async function getNextQueueOrder() {
  const [rows] = await pool.execute('SELECT COALESCE(MAX(queue_order), 0) AS n FROM campaigns');
  const n = rows[0]?.n;
  return (Number(n) || 0) + 1;
}

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

  const optedOut = await filterOptedOut(rows.map((r) => r.phoneNormalized));
  const filteredRows = optedOut.size > 0 ? rows.filter((r) => !optedOut.has(r.phoneNormalized)) : rows;
  filteredRows.forEach((r, i) => {
    r.sortOrder = i;
  });
  const rowsToInsert = filteredRows;
  for (let offset = 0; offset < rowsToInsert.length; offset += BATCH_INSERT_SIZE) {
    const slice = rowsToInsert.slice(offset, offset + BATCH_INSERT_SIZE);
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
  return rowsToInsert.length;
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

async function promoteQueuedCampaignToRunningIfDue(campaignId) {
  console.log('[CampaignRepository] Attempting to promote queued campaign:', campaignId);
  const [result] = await pool.execute(
    `UPDATE campaigns c
     SET c.status = 'running', c.error_message = NULL, c.started_at = COALESCE(c.started_at, CURRENT_TIMESTAMP), c.updated_at = CURRENT_TIMESTAMP
     WHERE c.id = ?
       AND c.status = 'queued'
       AND (c.scheduled_at IS NULL OR c.scheduled_at <= UTC_TIMESTAMP())`,
    [campaignId],
  );
  return Number(result.affectedRows) || 0;
}

async function getRunningCampaigns() {
  const [rows] = await pool.execute(
    `${CAMPAIGN_SELECT} WHERE c.status = 'running' ORDER BY c.started_at ASC`,
  );
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

async function getRunningCampaign() {
  const list = await getRunningCampaigns();
  return list[0] || null;
}

async function getQueuedCampaignsDueOrdered() {
  const [rows] = await pool.execute(
    `${CAMPAIGN_SELECT} WHERE c.status = 'queued'
     AND (c.scheduled_at IS NULL OR c.scheduled_at <= UTC_TIMESTAMP())
     ORDER BY c.queue_order ASC, c.created_at ASC`,
  );
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

async function claimQueuedAsRunning(campaignId) {
  console.log('[CampaignRepository] Attempting to claim queued campaign:', campaignId);
  const [result] = await pool.execute(
    `UPDATE campaigns c
     SET c.status = 'running', c.error_message = NULL, c.started_at = COALESCE(c.started_at, CURRENT_TIMESTAMP), c.updated_at = CURRENT_TIMESTAMP
     WHERE c.id = ?
       AND c.status = 'queued'`,
    [campaignId],
  );
  return Number(result.affectedRows) || 0;
}

async function claimPausedAsRunning(campaignId) {
  console.log('[CampaignRepository] Attempting to claim paused campaign:', campaignId);
  const [result] = await pool.execute(
    `UPDATE campaigns c
     SET c.status = 'running', c.error_message = NULL, c.updated_at = CURRENT_TIMESTAMP
     WHERE c.id = ?
       AND c.status = 'paused'`,
    [campaignId],
  );
  return Number(result.affectedRows) || 0;
}

async function getPausedCampaigns() {
  const [rows] = await pool.execute(
    `${CAMPAIGN_SELECT} WHERE c.status = 'paused' ORDER BY c.updated_at DESC`,
  );
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

async function getQueuedCampaigns() {
  const [rows] = await pool.execute(
    `${CAMPAIGN_SELECT} WHERE c.status = 'queued' ORDER BY c.queue_order ASC, c.created_at ASC`,
  );
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

const LISTABLE_STATUSES = new Set(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled', 'stopped']);

async function listCampaigns(opts = {}) {
  const { statuses } = opts;
  if (statuses && Array.isArray(statuses) && statuses.length > 0) {
    const safe = [...new Set(statuses.map((s) => String(s || '').trim().toLowerCase()).filter((s) => LISTABLE_STATUSES.has(s)))];
    if (safe.length === 0) {
      return [];
    }
    const ph = safe.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `${CAMPAIGN_SELECT} WHERE c.status IN (${ph}) ORDER BY c.created_at DESC`,
      safe,
    );
    return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
  }
  const [rows] = await pool.execute(`${CAMPAIGN_SELECT} ORDER BY c.created_at DESC`);
  return rows.map((r) => mapCampaignRow(r)).filter(Boolean);
}

async function getCampaignContactsSample(campaignId, limit = 20) {
  const lim = Math.max(1, Math.min(10000, Math.floor(Number(limit) || 1)));
  const [rows] = await pool.execute(
    `SELECT id, phone_normalized, first_send_status, sort_order, sent_at, last_error, attempt_count,
            meta_message_id, meta_delivery_status, meta_delivery_error, meta_delivery_updated_at
     FROM campaign_contacts
     WHERE campaign_id = ?
     ORDER BY id DESC
     LIMIT ${lim}`,
    [campaignId],
  );
  return rows;
}

const DELIVERY_STATUS_VALUES = new Set(['sent', 'delivered', 'read', 'failed']);

async function countCampaignContacts(campaignId, deliveryStatus) {
  const status = deliveryStatus && DELIVERY_STATUS_VALUES.has(deliveryStatus) ? deliveryStatus : null;
  const [[row]] = status
    ? await pool.execute(
        'SELECT COUNT(*) AS cnt FROM campaign_contacts WHERE campaign_id = ? AND meta_delivery_status = ?',
        [campaignId, status],
      )
    : await pool.execute(
        'SELECT COUNT(*) AS cnt FROM campaign_contacts WHERE campaign_id = ?',
        [campaignId],
      );
  return Number(row?.cnt) || 0;
}

/**
 * @returns {Promise<{ sent: number, delivered: number, read: number, failed: number }>}
 */
async function getCampaignDeliveryStatusCounts(campaignId) {
  const counts = { sent: 0, delivered: 0, read: 0, failed: 0 };
  const [rows] = await pool.execute(
    `SELECT meta_delivery_status AS status, COUNT(*) AS cnt
     FROM campaign_contacts
     WHERE campaign_id = ? AND meta_delivery_status IS NOT NULL
     GROUP BY meta_delivery_status`,
    [campaignId],
  );
  for (const r of rows || []) {
    const key = String(r.status || '');
    if (DELIVERY_STATUS_VALUES.has(key)) counts[key] = Number(r.cnt) || 0;
  }
  return counts;
}

async function listCampaignContactsPage(campaignId, page, limit, deliveryStatus) {
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const pg = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (pg - 1) * lim;
  const status = deliveryStatus && DELIVERY_STATUS_VALUES.has(deliveryStatus) ? deliveryStatus : null;
  const [rows] = status
    ? await pool.execute(
        `SELECT id, phone_normalized, first_send_status, sort_order, sent_at, last_error, attempt_count,
                meta_message_id, meta_delivery_status, meta_delivery_error, meta_delivery_updated_at
         FROM campaign_contacts
         WHERE campaign_id = ? AND meta_delivery_status = ?
         ORDER BY sort_order ASC, id ASC
         LIMIT ${lim} OFFSET ${offset}`,
        [campaignId, status],
      )
    : await pool.execute(
        `SELECT id, phone_normalized, first_send_status, sort_order, sent_at, last_error, attempt_count,
                meta_message_id, meta_delivery_status, meta_delivery_error, meta_delivery_updated_at
         FROM campaign_contacts
         WHERE campaign_id = ?
         ORDER BY sort_order ASC, id ASC
         LIMIT ${lim} OFFSET ${offset}`,
        [campaignId],
      );
  return rows;
}

async function updateCampaignStatus(campaignId, status, opts = {}) {
  const err = opts.errorMessage != null ? String(opts.errorMessage).slice(0, 65535) : null;

  if (status === 'running') {
    await pool.execute(
      `UPDATE campaigns SET status = ?, error_message = NULL, started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, campaignId],
    );
  } else if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'stopped') {
    await pool.execute(
      `UPDATE campaigns SET status = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
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

async function countPendingContacts(campaignId) {
  const cid = String(campaignId || '').trim();
  if (!cid) return 0;
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM campaign_contacts WHERE campaign_id = ? AND first_send_status = 'pending'`,
    [cid],
  );
  return Number(rows[0]?.cnt) || 0;
}

async function countDeliveredContacts(campaignId) {
  const cid = String(campaignId || '').trim();
  if (!cid) return 0;
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) AS cnt FROM campaign_contacts WHERE campaign_id = ? AND COALESCE(delivery_confirmed, 0) = 1`,
      [cid],
    );
    return Number(rows[0]?.cnt) || 0;
  } catch {
    return 0;
  }
}

async function getPendingDeliveredCountsByCampaignIds(campaignIds) {
  const map = new Map();
  const list = [...new Set((campaignIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!list.length) return map;
  const ph = list.map(() => '?').join(',');
  try {
    const [rows] = await pool.execute(
      `SELECT campaign_id AS campaignId,
              SUM(first_send_status = 'pending') AS pending_cnt,
              SUM(COALESCE(delivery_confirmed, 0) = 1) AS delivered_cnt
       FROM campaign_contacts
       WHERE campaign_id IN (${ph})
       GROUP BY campaign_id`,
      list,
    );
    for (const r of rows || []) {
      const id = String(r.campaignId || '').trim();
      if (!id) continue;
      map.set(id, {
        pending: Number(r.pending_cnt) || 0,
        delivered: Number(r.delivered_cnt) || 0,
      });
    }
  } catch {
    for (const id of list) map.set(id, { pending: 0, delivered: 0 });
  }
  for (const id of list) {
    if (!map.has(id)) map.set(id, { pending: 0, delivered: 0 });
  }
  return map;
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

async function getDailyContactsSentCount(campaignId, date) {
  const cid = String(campaignId || '').trim();
  const day = String(date || '').trim().slice(0, 10);
  if (!cid || !day) return 0;
  const dayStartUtc = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(dayStartUtc.getTime())) return 0;
  const rangeStart = new Date(dayStartUtc.getTime() - 2 * 60 * 60 * 1000);
  const rangeEnd = new Date(dayStartUtc.getTime() + 25 * 60 * 60 * 1000);
  const fmtUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS cnt
     FROM campaign_contacts
     WHERE campaign_id = ?
       AND first_send_status = 'sent'
       AND sent_at >= ?
       AND sent_at < ?`,
    [cid, fmtUtc(rangeStart), fmtUtc(rangeEnd)],
  );
  return Number(row?.cnt) || 0;
}

async function markContactSent(contactId, metaMessageId) {
  if (metaMessageId) {
    await pool.execute(
      `UPDATE campaign_contacts SET first_send_status = 'sent', sent_at = CURRENT_TIMESTAMP, meta_message_id = ? WHERE id = ?`,
      [String(metaMessageId), contactId],
    );
    return;
  }
  await pool.execute(
    `UPDATE campaign_contacts SET first_send_status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [contactId],
  );
}

const META_STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

async function updateContactMetaDeliveryStatus(messageId, status, errorDetail) {
  const rank = META_STATUS_RANK[status];
  if (!rank) return 0;
  const [result] = await pool.execute(
    `UPDATE campaign_contacts
     SET meta_delivery_status = ?, meta_delivery_error = ?, meta_delivery_updated_at = CURRENT_TIMESTAMP
     WHERE meta_message_id = ?
       AND COALESCE(
         CASE meta_delivery_status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 END,
         0
       ) <= ?`,
    [status, errorDetail != null ? String(errorDetail).slice(0, 65535) : null, String(messageId), rank],
  );
  return Number(result.affectedRows) || 0;
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
  const [rows] = await pool.execute(`${CAMPAIGN_SELECT} WHERE c.id = ? LIMIT 1`, [campaignId]);
  return mapCampaignRow(rows[0]);
}

async function updateCampaignSchedule(campaignId, schedule) {
  const opStart = String(schedule.operationalStart || '').trim().slice(0, 8);
  const opEnd = String(schedule.operationalEnd || '').trim().slice(0, 8);
  const opDays = String(schedule.operationalDays || '').trim().slice(0, 20);
  const startDate = String(schedule.campaignStartDate || '').trim().slice(0, 10);
  const endDate = String(schedule.campaignEndDate || '').trim().slice(0, 10);
  const dailyLimit =
    schedule.dailyLimitPerInstance != null && Number.isFinite(Number(schedule.dailyLimitPerInstance))
      ? Math.max(1, Math.floor(Number(schedule.dailyLimitPerInstance)))
      : null;

  const values = [opStart, opEnd, opDays, startDate, endDate];
  let sql = `UPDATE campaigns
     SET operational_start = ?, operational_end = ?, operational_days = ?,
         campaign_start_date = ?, campaign_end_date = ?`;
  if (dailyLimit != null) {
    sql += `, daily_limit_per_instance = ?`;
    values.push(dailyLimit);
  }
  sql += `, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'paused'`;
  values.push(campaignId);

  const [result] = await pool.execute(sql, values);
  return Number(result.affectedRows) || 0;
}

async function deleteCampaignById(id) {
  const [result] = await pool.execute('DELETE FROM campaigns WHERE id = ?', [id]);
  return Number(result.affectedRows) || 0;
}

module.exports = {
  createCampaign,
  getNextQueueOrder,
  insertCampaignContacts,
  setTotalContacts,
  getNextQueuedCampaign,
  promoteQueuedCampaignToRunningIfDue,
  getRunningCampaign,
  getRunningCampaigns,
  getQueuedCampaignsDueOrdered,
  claimQueuedAsRunning,
  claimPausedAsRunning,
  getPausedCampaigns,
  getQueuedCampaigns,
  listCampaigns,
  getCampaignContactsSample,
  updateCampaignStatus,
  incrementSentCount,
  incrementFailedCount,
  incrementSkippedCount,
  getPendingContacts,
  getDailyContactsSentCount,
  markContactSent,
  markContactFailed,
  markContactSkipped,
  updateContactMetaDeliveryStatus,
  getCampaignById,
  updateCampaignSchedule,
  countPendingContacts,
  countDeliveredContacts,
  getPendingDeliveredCountsByCampaignIds,
  countCampaignContacts,
  getCampaignDeliveryStatusCounts,
  listCampaignContactsPage,
  deleteCampaignById,
};
