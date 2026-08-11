/**
 * Message 2 branching logic for a non-opt-out inbound reply to Message 1. Button taps stay
 * deterministic (fast, free, unambiguous); free-text replies route through the AI reply service
 * so the conversation can go beyond the three known branches and still sound natural. All
 * replies are sent as free-form text — within Meta's 24h customer-service window, needing no
 * separate template approval.
 */
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { findUniversityLinkCandidates } = require('../repositories/universityLinkRepository');
const {
  hasPendingUniversityRequest,
  setPendingUniversityRequest,
  clearPendingUniversityRequest,
} = require('../repositories/pendingRequestRepository');
const conversationRepository = require('../repositories/conversationRepository');
const aiReplyScheduler = require('./aiReplyScheduler');
const { classifyReplyIntent } = require('../utils/replyIntent');
const metaWhatsApp = require('../metaWhatsApp');
const { parseContactPayload } = require('../utils/contactPayload');
const {
  ASK_WHICH_UNIVERSITY_TEXT,
  NOT_INTERESTED_TEXT,
  UNIVERSITY_LINK_NOT_FOUND_TEXT,
  INTERESTED_NO_LINK_TEXT,
  universityLinkFoundText,
  interestedText,
  universityDisambiguationText,
} = require('../utils/scriptedReplies');
const { createLogger } = require('../utils/logger');

const log = createLogger('metaWebhook');

async function sendReplyText(toPhone, text, campaignId = null, sender = 'system') {
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
    sender,
    metaMessageId: res?.messages?.[0]?.id ?? null,
    messageType: 'text',
    bodyText: text,
  });
}

/**
 * @param {{ fromPhone: string, campaignId: string|null, messageType: 'text'|'button',
 *   bodyText: string|null, buttonId: string|null, buttonTitle: string|null,
 *   contactPayloadJson: string|null, metaMessageId: string|null }} params
 */
async function handleReply({ fromPhone, campaignId, messageType, bodyText, buttonId, buttonTitle, contactPayloadJson, metaMessageId }) {
  try {
    const awaitingUniversity = await hasPendingUniversityRequest(fromPhone);
    if (awaitingUniversity) {
      const universityName = bodyText != null ? String(bodyText).trim() : '';
      const candidates = await findUniversityLinkCandidates(universityName);

      if (candidates.length > 1) {
        // Genuinely ambiguous (e.g. "Leeds" matches 5 real universities) — ask which one instead
        // of silently guessing, and stay in the same pending state for their next reply.
        await sendReplyText(fromPhone, universityDisambiguationText(candidates), campaignId);
        log.info(
          { event: 'meta_reply_different_uni_ambiguous', fromPhone, campaignId, universityName, candidateCount: candidates.length },
          'meta_reply_different_uni_ambiguous',
        );
        return;
      }

      await clearPendingUniversityRequest(fromPhone);
      const match = candidates[0] || null;
      const text = match
        ? (match.groupLink ? universityLinkFoundText(match.groupLink) : UNIVERSITY_LINK_NOT_FOUND_TEXT)
        : UNIVERSITY_LINK_NOT_FOUND_TEXT;
      await sendReplyText(fromPhone, text, campaignId);
      if (universityName) {
        await conversationRepository.applyLeadSignals(fromPhone, {
          confirmedInterest: true,
          confirmedUniversity: match ? match.universityName : universityName,
        });
      }
      log.info(
        { event: 'meta_reply_different_uni_answered', fromPhone, campaignId, universityName, matched: Boolean(match) },
        'meta_reply_different_uni_answered',
      );
      return;
    }

    if (messageType === 'button') {
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
        await conversationRepository.applyLeadSignals(fromPhone, {
          confirmedInterest: true,
          confirmedUniversity: payload.university || null,
        });
        log.info({ event: 'meta_reply_intent', fromPhone, campaignId, intent, hasLink: Boolean(link) }, 'meta_reply_intent');
        return;
      }

      if (intent === 'not_interested') {
        await sendReplyText(fromPhone, NOT_INTERESTED_TEXT, campaignId);
        log.info({ event: 'meta_reply_intent', fromPhone, campaignId, intent }, 'meta_reply_intent');
        return;
      }

      log.info(
        { event: 'meta_reply_intent', fromPhone, campaignId, intent: 'unrecognized_button', buttonId },
        'meta_reply_intent',
      );
      return;
    }

    // Free-text reply that isn't answering a pending "which university" prompt — hand off to AI,
    // with a human-like delay + typing indicator instead of sending instantly (see aiReplyWorker).
    await aiReplyScheduler.scheduleAiReply({ fromPhone, campaignId, bodyText, contactPayloadJson, metaMessageId });
  } catch (err) {
    log.warn({ err: err.message, event: 'meta_reply_sequence_failed', fromPhone }, 'Failed to process reply sequence');
  }
}

module.exports = { handleReply, sendReplyText };
