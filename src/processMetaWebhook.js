/**
 * Processes real delivery-status events from Meta's WhatsApp Cloud API webhook
 * (POST /api/webhook/meta) and applies them to the matching campaign_contacts row.
 */
const { updateContactMetaDeliveryStatus } = require('./repositories/campaignRepository');
const { createLogger } = require('./utils/logger');

const log = createLogger('metaWebhook');

const KNOWN_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

/**
 * @param {object} error - a Meta statuses[].errors[] entry
 * @returns {string}
 */
function formatStatusError(error) {
  if (!error || typeof error !== 'object') return 'Meta delivery failed';
  const parts = [];
  if (error.code != null) parts.push(String(error.code));
  const label = error.title || error.message || error.error_data?.details;
  if (label) parts.push(String(label));
  return parts.length > 0 ? parts.join(': ') : 'Meta delivery failed';
}

/**
 * @param {Buffer|string} rawBody - raw webhook POST body (already signature-verified by the caller)
 */
async function processMetaStatusWebhook(rawBody) {
  let payload;
  try {
    const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    payload = text ? JSON.parse(text) : null;
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_webhook_invalid_json' }, 'Meta webhook: invalid JSON body');
    return;
  }
  if (!payload || typeof payload !== 'object') return;

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const statuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
      for (const status of statuses) {
        // eslint-disable-next-line no-await-in-loop
        await applyStatusEvent(status);
      }
    }
  }
}

/**
 * @param {object} status - a single Meta statuses[] entry
 */
async function applyStatusEvent(status) {
  try {
    const messageId = status?.id != null ? String(status.id) : '';
    const statusValue = status?.status != null ? String(status.status) : '';
    if (!messageId || !KNOWN_STATUSES.has(statusValue)) return;

    const errorDetail =
      statusValue === 'failed' && Array.isArray(status?.errors) && status.errors.length > 0
        ? formatStatusError(status.errors[0])
        : null;

    const affected = await updateContactMetaDeliveryStatus(messageId, statusValue, errorDetail);
    log.info(
      { event: 'meta_delivery_status_applied', messageId, status: statusValue, affected },
      'meta_delivery_status_applied',
    );
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_webhook_status_apply_failed' }, 'Meta webhook: failed to apply status event');
  }
}

module.exports = { processMetaStatusWebhook };
