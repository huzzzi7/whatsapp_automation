/**
 * API-facing campaign shape (from repository mapCampaignRow / camelCase).
 * @param {object|null|undefined} c
 * @returns {object|null}
 */
function formatCampaign(c) {
  if (!c) return null;
  const total = Number(c.totalContacts) || 0;
  const sent = Number(c.sentCount) || 0;

  let failed = Number(c.failedCount);
  if (!Number.isFinite(failed)) {
    failed = Number(c.failedOrSkippedCount) || 0;
  } else {
    failed = Math.max(0, failed);
  }

  let skipped = Number(c.skippedCount);
  if (!Number.isFinite(skipped)) {
    skipped = 0;
  } else {
    skipped = Math.max(0, skipped);
  }

  const remaining = Math.max(0, total - sent - failed - skipped);
  const processed = sent + failed + skipped;
  const percent = total > 0 ? Number(((processed / total) * 100).toFixed(2)) : 0;
  const st = String(c.status || '').toLowerCase();
  const isTerminal = ['completed', 'stopped', 'failed', 'cancelled'].includes(st);
  const cappedPercent = !isTerminal && percent >= 100 ? 99 : percent;
  const legacyFailedOrSkipped = failed + skipped;

  const pendingFromDb = c.pendingCount != null && Number.isFinite(Number(c.pendingCount)) ? Number(c.pendingCount) : null;
  const deliveredFromDb = c.deliveredCount != null && Number.isFinite(Number(c.deliveredCount)) ? Number(c.deliveredCount) : null;

  const instanceDetails = Array.isArray(c.instanceDetails) ? c.instanceDetails : null;

  const cleanName = c.name && String(c.name).trim() ? String(c.name).trim() : null;
  const idStr = c.id != null ? String(c.id) : '';
  const shortId = idStr.length >= 6 ? idStr.slice(0, 6) : idStr;

  return {
    id: c.id,
    name: cleanName,
    displayName: cleanName || `Campaign ${shortId}`,
    status: c.status,
    greenInstanceId: c.greenInstanceId,
    greenInstanceName: c.greenInstanceName ?? null,
    greenInstancePhone: c.greenInstancePhone ?? null,
    totalContacts: total,
    sentCount: sent,
    failedCount: failed,
    skippedCount: skipped,
    failedOrSkippedCount: legacyFailedOrSkipped,
    remaining,
    percentComplete: cappedPercent,
    pendingCount: pendingFromDb,
    deliveredCount: deliveredFromDb,
    queueOrder: c.queueOrder,
    errorMessage: c.errorMessage,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    scheduledAt: c.scheduledAt ?? null,
    operationalStart: c.operationalStart ?? null,
    operationalEnd: c.operationalEnd ?? null,
    operationalDays: c.operationalDays ?? null,
    campaignEndDate: c.campaignEndDate ?? null,
    dailyLimitPerInstance: c.dailyLimitPerInstance ?? null,
    isMultiInstance: Boolean(c.isMultiInstance),
    instanceDetails,
  };
}

/**
 * @param {object} row - raw campaign_contacts row
 */
function formatContactSample(row) {
  if (!row) return null;
  return {
    id: row.id,
    phoneNormalized: row.phone_normalized,
    firstSendStatus: row.first_send_status,
    sortOrder: row.sort_order,
    sentAt: row.sent_at,
    lastError: row.last_error,
    attemptCount: row.attempt_count,
  };
}

module.exports = { formatCampaign, formatContactSample };
