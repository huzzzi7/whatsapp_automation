/**
 * Processes real-time events from Meta's WhatsApp Cloud API webhook (POST /api/webhook/meta):
 * - delivery-status events (statuses[]) → applied to the matching campaign_contacts row
 * - inbound messages (messages[]) → logged, checked for opt-out, handed off for reply sequencing
 */
const { updateContactMetaDeliveryStatus } = require('./repositories/campaignRepository');
const { logInboundMessage, findRecentCampaignContactByPhone } = require('./repositories/inboundMessageRepository');
const { addOptOut, isOptedOut } = require('./repositories/optOutRepository');
const { getMetaConfigRow } = require('./repositories/metaConfigRepository');
const metaWhatsApp = require('./metaWhatsApp');
const { OPT_OUT_BUTTON_PAYLOAD, OPT_OUT_KEYWORDS } = require('./utils/optOut');
const replySequence = require('./services/replySequence');
const { createLogger } = require('./utils/logger');

const log = createLogger('metaWebhook');

const KNOWN_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

const OPT_OUT_ACK_TEXT = "You've been unsubscribed and won't receive further messages from us.";

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
      const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
      for (const message of messages) {
        // eslint-disable-next-line no-await-in-loop
        await applyInboundMessage(message);
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

/**
 * @param {object} message - a single Meta messages[] entry
 */
async function applyInboundMessage(message) {
  try {
    const fromPhone = message?.from != null ? String(message.from).trim() : '';
    if (!fromPhone) return;

    const metaMessageId = message?.id != null ? String(message.id) : null;
    const type = message?.type != null ? String(message.type) : '';

    let messageType = 'text';
    let bodyText = null;
    let buttonId = null;
    let buttonTitle = null;

    if (type === 'button') {
      messageType = 'button';
      buttonId = message?.button?.payload != null ? String(message.button.payload) : null;
      buttonTitle = message?.button?.text != null ? String(message.button.text) : null;
    } else if (type === 'text') {
      messageType = 'text';
      bodyText = message?.text?.body != null ? String(message.text.body) : null;
    } else {
      // Other inbound types (image, interactive list reply, etc.) aren't part of this reply
      // sequence yet — still logged for visibility, no action taken.
      messageType = type || 'text';
    }

    const recentContact = await findRecentCampaignContactByPhone(fromPhone);
    const campaignId = recentContact?.campaignId ?? null;

    const logged = await logInboundMessage({
      metaMessageId,
      fromPhone,
      campaignId,
      messageType,
      bodyText,
      buttonId,
      buttonTitle,
    });
    if (logged === 0) {
      // Already processed this exact wamid (Meta retried the webhook delivery) — skip re-acting on it.
      return;
    }

    // Button payload behavior varies: some templates let you set a custom payload (e.g. "OPT_OUT"),
    // others default the payload to the button's display text (e.g. "Opt out"). Match either way.
    const isOptOutButton =
      messageType === 'button' &&
      (buttonId === OPT_OUT_BUTTON_PAYLOAD ||
        OPT_OUT_KEYWORDS.test(buttonId || '') ||
        OPT_OUT_KEYWORDS.test(buttonTitle || ''));
    const isOptOutKeyword = messageType === 'text' && bodyText != null && OPT_OUT_KEYWORDS.test(bodyText);

    if (isOptOutButton || isOptOutKeyword) {
      await handleOptOut(fromPhone, isOptOutButton ? 'button' : 'keyword');
      return;
    }

    await replySequence.handleReply({
      fromPhone,
      campaignId,
      messageType,
      bodyText,
      buttonId,
      buttonTitle,
      contactPayloadJson: recentContact?.payloadJson,
    });
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_webhook_inbound_apply_failed' }, 'Meta webhook: failed to apply inbound message');
  }
}

/**
 * @param {string} fromPhone
 * @param {'button'|'keyword'} source
 */
async function handleOptOut(fromPhone, source) {
  const alreadyOptedOut = await isOptedOut(fromPhone);
  await addOptOut(fromPhone, source);
  log.info({ event: 'meta_opt_out_recorded', fromPhone, source, alreadyOptedOut }, 'meta_opt_out_recorded');

  if (alreadyOptedOut) return;

  try {
    const metaConfig = await getMetaConfigRow();
    if (!metaConfig || !metaConfig.isEnabled) return;
    await metaWhatsApp.sendTextMessage({
      to: fromPhone,
      phoneNumberId: metaConfig.phoneNumberId,
      accessToken: metaConfig.accessToken,
      text: OPT_OUT_ACK_TEXT,
      graphVersion: metaConfig.graphVersion || undefined,
    });
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_opt_out_ack_send_failed', fromPhone }, 'Failed to send opt-out acknowledgment');
  }
}

module.exports = { processMetaStatusWebhook };
