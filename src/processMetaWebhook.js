/**
 * Processes real-time events from Meta's WhatsApp Cloud API webhook (POST /api/webhook/meta):
 * - delivery-status events (statuses[]) → applied to the matching campaign_contacts row
 * - inbound messages (messages[]) → logged to the conversation thread, checked for opt-out,
 *   handed off for reply sequencing
 */
const { updateContactMetaDeliveryStatus } = require('./repositories/campaignRepository');
const { findRecentCampaignContactByPhone } = require('./repositories/inboundMessageRepository');
const { addOptOut, isOptedOut } = require('./repositories/optOutRepository');
const { getMetaConfigRow } = require('./repositories/metaConfigRepository');
const conversationRepository = require('./repositories/conversationRepository');
const metaWhatsApp = require('./metaWhatsApp');
const { OPT_OUT_BUTTON_PAYLOAD, OPT_OUT_KEYWORDS } = require('./utils/optOut');
const { writeMediaFile } = require('./utils/mediaStorage');
const replySequence = require('./services/replySequence');
const { createLogger } = require('./utils/logger');

const log = createLogger('metaWebhook');

const KNOWN_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);
const MEDIA_TYPES = new Set(['image', 'document', 'video', 'audio', 'sticker']);

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
      const contacts = Array.isArray(change?.value?.contacts) ? change.value.contacts : [];
      const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
      for (const message of messages) {
        const contact = contacts.find((c) => c?.wa_id === message?.from);
        const displayName = contact?.profile?.name != null ? String(contact.profile.name) : null;
        // eslint-disable-next-line no-await-in-loop
        await applyInboundMessage(message, displayName);
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
 * Downloads inbound media immediately (Meta's URL expires after 5 minutes) and stores it under
 * MEDIA_DIR. Filename on disk is a bare UUID; the mime type is tracked separately in the DB so
 * the media-serving route can set the right Content-Type.
 * @returns {Promise<{ path: string, mimeType: string }>}
 */
async function downloadAndStoreInboundMedia(metaMediaId) {
  const metaConfig = await getMetaConfigRow();
  if (!metaConfig || !metaConfig.accessToken) {
    throw new Error('Meta config missing/disabled, cannot download media');
  }
  const { buffer, mimeType } = await metaWhatsApp.downloadMedia({
    mediaId: metaMediaId,
    phoneNumberId: metaConfig.phoneNumberId,
    accessToken: metaConfig.accessToken,
    graphVersion: metaConfig.graphVersion || undefined,
  });
  const filename = writeMediaFile(buffer);
  return { path: filename, mimeType };
}

/**
 * @param {object} message - a single Meta messages[] entry
 * @param {string|null} displayName - the customer's own WhatsApp display name, from webhook contacts[]
 */
async function applyInboundMessage(message, displayName) {
  try {
    const fromPhone = message?.from != null ? String(message.from).trim() : '';
    if (!fromPhone) return;

    const metaMessageId = message?.id != null ? String(message.id) : null;
    const type = message?.type != null ? String(message.type) : '';

    let messageType = 'text';
    let bodyText = null;
    let buttonId = null;
    let buttonTitle = null;
    let mediaPath = null;
    let mediaMimeType = null;
    let mediaFilename = null;
    let mediaCaption = null;
    let reactionEmoji = null;
    let reactionTargetMessageId = null;

    if (type === 'button') {
      messageType = 'button';
      buttonId = message?.button?.payload != null ? String(message.button.payload) : null;
      buttonTitle = message?.button?.text != null ? String(message.button.text) : null;
    } else if (type === 'text') {
      messageType = 'text';
      bodyText = message?.text?.body != null ? String(message.text.body) : null;
    } else if (MEDIA_TYPES.has(type)) {
      messageType = type;
      const mediaObj = message?.[type];
      mediaCaption = mediaObj?.caption != null ? String(mediaObj.caption) : null;
      mediaFilename = mediaObj?.filename != null ? String(mediaObj.filename) : null;
      const metaMediaId = mediaObj?.id != null ? String(mediaObj.id) : null;
      if (metaMediaId) {
        try {
          const downloaded = await downloadAndStoreInboundMedia(metaMediaId);
          mediaPath = downloaded.path;
          mediaMimeType = downloaded.mimeType;
        } catch (err) {
          log.warn(
            { err: err.message, event: 'meta_inbound_media_download_failed', metaMediaId },
            'Failed to download inbound media',
          );
        }
      }
    } else if (type === 'reaction') {
      messageType = 'reaction';
      reactionEmoji = message?.reaction?.emoji != null ? String(message.reaction.emoji) : null;
      reactionTargetMessageId = message?.reaction?.message_id != null ? String(message.reaction.message_id) : null;
    } else {
      messageType = type || 'text';
    }

    const recentContact = await findRecentCampaignContactByPhone(fromPhone);
    const campaignId = recentContact?.campaignId ?? null;

    const logged = await conversationRepository.logMessage({
      phoneNormalized: fromPhone,
      campaignId,
      direction: 'inbound',
      sender: 'customer',
      metaMessageId,
      messageType,
      bodyText,
      buttonId,
      buttonTitle,
      mediaPath,
      mediaMimeType,
      mediaFilename,
      mediaCaption,
      reactionEmoji,
      reactionTargetMessageId,
      displayName,
    });
    if (logged === 0) {
      // Already processed this exact wamid (Meta retried the webhook delivery) — skip re-acting on it.
      return;
    }

    // Opt-out and the reply sequence only apply to text/button replies to Message 1.
    if (messageType !== 'text' && messageType !== 'button') return;

    // Button payload behavior varies: some templates let you set a custom payload (e.g. "OPT_OUT"),
    // others default the payload to the button's display text (e.g. "Opt out"). Match either way.
    const isOptOutButton =
      messageType === 'button' &&
      (buttonId === OPT_OUT_BUTTON_PAYLOAD ||
        OPT_OUT_KEYWORDS.test(buttonId || '') ||
        OPT_OUT_KEYWORDS.test(buttonTitle || ''));
    const isOptOutKeyword = messageType === 'text' && bodyText != null && OPT_OUT_KEYWORDS.test(bodyText);

    if (isOptOutButton || isOptOutKeyword) {
      await handleOptOut(fromPhone, isOptOutButton ? 'button' : 'keyword', campaignId);
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
      metaMessageId,
    });
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_webhook_inbound_apply_failed' }, 'Meta webhook: failed to apply inbound message');
  }
}

/**
 * @param {string} fromPhone
 * @param {'button'|'keyword'} source
 * @param {string|null} campaignId
 */
async function handleOptOut(fromPhone, source, campaignId = null) {
  const alreadyOptedOut = await isOptedOut(fromPhone);
  await addOptOut(fromPhone, source);
  log.info({ event: 'meta_opt_out_recorded', fromPhone, source, alreadyOptedOut }, 'meta_opt_out_recorded');

  if (alreadyOptedOut) return;

  try {
    const metaConfig = await getMetaConfigRow();
    if (!metaConfig || !metaConfig.isEnabled) return;
    const res = await metaWhatsApp.sendTextMessage({
      to: fromPhone,
      phoneNumberId: metaConfig.phoneNumberId,
      accessToken: metaConfig.accessToken,
      text: OPT_OUT_ACK_TEXT,
      graphVersion: metaConfig.graphVersion || undefined,
    });
    await conversationRepository.logMessage({
      phoneNormalized: fromPhone,
      campaignId,
      direction: 'outbound',
      sender: 'system',
      metaMessageId: res?.messages?.[0]?.id ?? null,
      messageType: 'text',
      bodyText: OPT_OUT_ACK_TEXT,
    });
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_opt_out_ack_send_failed', fromPhone }, 'Failed to send opt-out acknowledgment');
  }
}

module.exports = { processMetaStatusWebhook };
