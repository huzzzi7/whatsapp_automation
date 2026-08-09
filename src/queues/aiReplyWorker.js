/**
 * Consumes aiReplyQueue: fires after the human-like delay set by aiReplyScheduler. Shows Meta's
 * native typing indicator, pauses briefly so it's actually visible to the customer, then
 * generates and sends the AI reply. Runs in the same process as coordinatorWorker (required from
 * there) so no extra PM2 process is needed.
 */
const { Worker } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { findUniversityLink } = require('../repositories/universityLinkRepository');
const metaWhatsApp = require('../metaWhatsApp');
const aiReplyService = require('../services/aiReplyService');
const conversationRepository = require('../repositories/conversationRepository');
const { sendReplyText } = require('../services/replySequence');
const { parseContactPayload } = require('../utils/contactPayload');
const {
  UNIVERSITY_LINK_NOT_FOUND_TEXT,
  INTERESTED_NO_LINK_TEXT,
  universityLinkFoundText,
  interestedText,
} = require('../utils/scriptedReplies');
const { createLogger } = require('../utils/logger');

const log = createLogger('aiReplyWorker');

function sleepMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

function randomInt(minMs, maxMs) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

async function processAiReplyJob(job) {
  const { fromPhone, campaignId, bodyText, contactPayloadJson, metaMessageId } = job.data;

  const metaConfig = await getMetaConfigRow();
  if (!metaConfig || !metaConfig.isEnabled) {
    log.warn({ event: 'ai_reply_send_skipped_no_config', fromPhone }, 'Meta config missing/disabled, cannot send AI reply');
    return;
  }

  if (metaMessageId) {
    try {
      await metaWhatsApp.markAsReadWithTyping({
        phoneNumberId: metaConfig.phoneNumberId,
        accessToken: metaConfig.accessToken,
        messageId: metaMessageId,
        graphVersion: metaConfig.graphVersion || undefined,
      });
    } catch (err) {
      log.warn(
        { err: err.message, event: 'ai_reply_typing_indicator_failed', fromPhone },
        'Failed to show typing indicator, continuing without it',
      );
    }
  }

  // Give the typing indicator a moment to actually be visible before the message lands.
  await sleepMs(randomInt(3000, 8000));

  const aiResult = await aiReplyService.generateReply({ fromPhone, bodyText, contactPayloadJson });
  if (!aiResult) {
    log.warn({ event: 'ai_reply_generation_unavailable', fromPhone, campaignId }, 'AI reply unavailable, no response sent');
    return;
  }

  // The AI only extracts *signals* (confirmedUniversity / confirmedInterest) reliably — the exact
  // Message 2 script wording and the actual group/ticket link lookup are done here deterministically,
  // the same way the button-driven path does it, rather than trusting the model's own paraphrase
  // or letting it invent a link for a university it wasn't given.
  let finalReply = aiResult.reply;
  let scriptOverride = null;
  if (aiResult.confirmedUniversity) {
    const link = await findUniversityLink(aiResult.confirmedUniversity);
    finalReply = link ? universityLinkFoundText(link) : UNIVERSITY_LINK_NOT_FOUND_TEXT;
    scriptOverride = link ? 'different_uni_link_found' : 'different_uni_link_not_found';
  } else if (aiResult.confirmedInterest) {
    const payload = parseContactPayload(contactPayloadJson);
    const ticketLink = payload.link != null && String(payload.link).trim() ? String(payload.link).trim() : null;
    finalReply = ticketLink ? interestedText(ticketLink) : INTERESTED_NO_LINK_TEXT;
    scriptOverride = ticketLink ? 'interested_ticket_link' : 'interested_no_link';
  }

  // Safety net: the model is instructed to only re-confirm signals on the message that newly
  // states them, but if it slips and re-emits an already-sent signal (e.g. after "thanks"), don't
  // let that resend the identical scripted message — fall back to the model's own natural reply.
  if (scriptOverride) {
    const recentHistory = await conversationRepository.getConversationMessages(fromPhone, { limit: 5 });
    const lastOutbound = [...recentHistory].reverse().find((m) => m.direction === 'outbound');
    if (lastOutbound && lastOutbound.bodyText === finalReply) {
      log.info(
        { event: 'ai_reply_override_deduped', fromPhone, campaignId, scriptOverride },
        'Scripted reply matches the last outbound message, sending AI reply instead to avoid a duplicate',
      );
      finalReply = aiResult.reply;
      scriptOverride = null;
    }
  }

  await sendReplyText(fromPhone, finalReply, campaignId, 'ai');
  await conversationRepository.applyLeadSignals(fromPhone, {
    confirmedInterest: aiResult.confirmedInterest,
    confirmedUniversity: aiResult.confirmedUniversity,
  });

  log.info(
    {
      event: 'meta_reply_ai_generated',
      fromPhone,
      campaignId,
      confirmedInterest: aiResult.confirmedInterest,
      confirmedUniversity: aiResult.confirmedUniversity,
      needsHuman: aiResult.needsHuman,
      scriptOverride,
    },
    'meta_reply_ai_generated',
  );
}

const aiReplyWorker = new Worker('aiReplyQueue', processAiReplyJob, {
  connection: bullMqConnection,
  concurrency: 5,
  skipVersionCheck: bullMqSkipVersionCheck,
});

aiReplyWorker.on('error', (err) => log.error({ err: err.message, event: 'ai_reply_worker_error' }, 'aiReplyWorker error'));
aiReplyWorker.on('failed', (job, err) =>
  log.error({ err: err.message, bullJobId: job?.id, fromPhone: job?.data?.fromPhone, event: 'ai_reply_job_failed' }, 'AI reply job failed permanently'),
);

log.info({ event: 'ai_reply_worker_started', queue: 'aiReplyQueue', concurrency: 5 }, 'aiReplyWorker started');

async function closeAiReplyWorker() {
  await aiReplyWorker.close();
  log.info({ event: 'ai_reply_worker_closed' }, 'aiReplyWorker closed');
}

module.exports = { aiReplyWorker, closeAiReplyWorker };
