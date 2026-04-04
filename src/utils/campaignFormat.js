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
  const legacyFailedOrSkipped = failed + skipped;

  return {
    id: c.id,
    name: c.name,
    status: c.status,
    greenInstanceId: c.greenInstanceId,
    totalContacts: total,
    sentCount: sent,
    failedCount: failed,
    skippedCount: skipped,
    failedOrSkippedCount: legacyFailedOrSkipped,
    remaining,
    percentComplete: percent,
    queueOrder: c.queueOrder,
    errorMessage: c.errorMessage,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
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
