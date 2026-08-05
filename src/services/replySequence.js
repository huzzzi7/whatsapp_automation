/**
 * Message 2 branching logic: given a non-opt-out inbound reply to Message 1, decides which
 * Message 2 variant to send. Always sent as free-form text — Message 2 is a direct reply to the
 * recipient's own inbound message, so it's within Meta's 24h customer-service window and needs
 * no separate template approval.
 */
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { findUniversityLink } = require('../repositories/universityLinkRepository');
const {
  hasPendingUniversityRequest,
  setPendingUniversityRequest,
  clearPendingUniversityRequest,
} = require('../repositories/pendingRequestRepository');
const conversationRepository = require('../repositories/conversationRepository');
const { classifyReplyIntent } = require('../utils/replyIntent');
const metaWhatsApp = require('../metaWhatsApp');
const { createLogger } = require('../utils/logger');

const log = createLogger('metaWebhook');

const ASK_WHICH_UNIVERSITY_TEXT = 'Which university are you going to?';
const NOT_INTERESTED_TEXT =
  "No problem, if you need anything related to your university Freshers' Week, let us know 🙂";
const UNIVERSITY_LINK_NOT_FOUND_TEXT = "Thanks — we'll find that group for you and follow up shortly.";
const INTERESTED_NO_LINK_TEXT = "Let us know and we'll send you the link to buy your official freshers week tickets.";

function universityLinkFoundText(link) {
  return `Here's the link ${link} for you to join, if you need anything else let us know.`;
}

function interestedText(link) {
  return `Buy the official freshers week tickets for your university here ${link}`;
}

function parseContactPayload(payloadJson) {
  if (payloadJson == null || payloadJson === '') return {};
  try {
    const obj = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

async function sendReplyText(toPhone, text, campaignId = null) {
  const metaConfig = await getMetaConfigRow();
  if (!metaConfig || !metaConfig.isEnabled) {
    log.warn({ event: 'meta_reply_send_skipped_no_config', toPhone }, 'Meta config missing/disabled, cannot send reply');
    return;
  }
  const res = await metaWhatsApp.sendTextMessage({
    to: toPhone,
    phoneNumberId: metaConfig.phoneNumberId,
    accessToken: metaConfig.accessToken,
    text,
    graphVersion: metaConfig.graphVersion || undefined,
  });
  await conversationRepository.logMessage({
    phoneNormalized: toPhone,
    campaignId,
    direction: 'outbound',
    sender: 'system',
    metaMessageId: res?.messages?.[0]?.id ?? null,
    messageType: 'text',
    bodyText: text,
  });
}

/**
 * @param {{ fromPhone: string, campaignId: string|null, messageType: 'text'|'button',
 *   bodyText: string|null, buttonId: string|null, buttonTitle: string|null,
 *   contactPayloadJson: string|null }} params
 */
async function handleReply({ fromPhone, campaignId, messageType, bodyText, buttonId, buttonTitle, contactPayloadJson }) {
  try {
    const awaitingUniversity = await hasPendingUniversityRequest(fromPhone);
    if (awaitingUniversity) {
      await clearPendingUniversityRequest(fromPhone);
      const universityName = bodyText != null ? String(bodyText).trim() : '';
      const link = await findUniversityLink(universityName);
      await sendReplyText(fromPhone, link ? universityLinkFoundText(link) : UNIVERSITY_LINK_NOT_FOUND_TEXT, campaignId);
      log.info(
        { event: 'meta_reply_different_uni_answered', fromPhone, campaignId, universityName, matched: Boolean(link) },
        'meta_reply_different_uni_answered',
      );
      return;
    }

    const intent = classifyReplyIntent({ messageType, buttonId, buttonTitle, bodyText });

    if (intent === 'different_uni') {
      await setPendingUniversityRequest(fromPhone);
      await sendReplyText(fromPhone, ASK_WHICH_UNIVERSITY_TEXT, campaignId);
      log.info({ event: 'meta_reply_intent', fromPhone, campaignId, intent }, 'meta_reply_intent');
      return;
    }

    if (intent === 'interested') {
      const payload = parseContactPayload(contactPayloadJson);
      const link = payload.link != null && String(payload.link).trim() ? String(payload.link).trim() : null;
      await sendReplyText(fromPhone, link ? interestedText(link) : INTERESTED_NO_LINK_TEXT, campaignId);
      log.info({ event: 'meta_reply_intent', fromPhone, campaignId, intent, hasLink: Boolean(link) }, 'meta_reply_intent');
      return;
    }

    if (intent === 'not_interested') {
      await sendReplyText(fromPhone, NOT_INTERESTED_TEXT, campaignId);
      log.info({ event: 'meta_reply_intent', fromPhone, campaignId, intent }, 'meta_reply_intent');
      return;
    }

    log.info(
      { event: 'meta_reply_intent', fromPhone, campaignId, intent: 'unrecognized', messageType, buttonId },
      'meta_reply_intent',
    );
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_reply_sequence_failed', fromPhone }, 'Failed to process reply sequence');
  }
}

module.exports = { handleReply };
