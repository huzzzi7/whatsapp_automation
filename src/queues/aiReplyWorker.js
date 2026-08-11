/**
 * Consumes aiReplyQueue: fires after the human-like delay set by aiReplyScheduler. Shows Meta's
 * native typing indicator, pauses briefly so it's actually visible to the customer, then
 * generates and sends the AI reply. Runs in the same process as coordinatorWorker (required from
 * there) so no extra PM2 process is needed.
 */
const { Worker } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { findUniversityLinkCandidates, findUniversityLinkExact } = require('../repositories/universityLinkRepository');
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
  universityDisambiguationText,
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

function sameUniversity(a, b) {
  return Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Decides what a freshly AI-extracted university name should actually do, against whatever this
 * conversation has already confirmed:
 *  - 'not_found': no stored university matches this name at all.
 *  - 'ambiguous': the name matches multiple real universities (e.g. "Leeds" matches 5) and none of
 *    them is already this conversation's confirmed one — ask which, don't touch anything stored.
 *  - 'transition': resolves to exactly one university that's NEW (different from — or nothing was
 *    — already confirmed) — this is the moment to send the group link and store it.
 *  - 'same': resolves to the university already confirmed earlier in this conversation — there's
 *    nothing new to announce, so the AI's own (now fact-corrected) reply should stand instead of
 *    resending the scripted link again.
 * @param {{confirmedUniversity: string|null}|null} conv
 * @param {string} rawName
 */
async function resolveUniversitySignal(conv, rawName) {
  const candidates = await findUniversityLinkCandidates(rawName);
  if (candidates.length === 0) {
    return { action: 'not_found', rawName };
  }
  if (candidates.length === 1) {
    const university = candidates[0];
    return { action: sameUniversity(conv?.confirmedUniversity, university.universityName) ? 'same' : 'transition', university };
  }
  // Ambiguous — but if one of the candidates is already this conversation's confirmed university,
  // treat a vaguer re-mention (e.g. bare "Leeds" after "University of Leeds" was already settled)
  // as still referring to that one, rather than re-asking or risking a different arbitrary pick.
  const already = conv?.confirmedUniversity
    ? candidates.find((c) => sameUniversity(c.universityName, conv.confirmedUniversity))
    : null;
  if (already) return { action: 'same', university: already };
  return { action: 'ambiguous', candidates };
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

  const conv = await conversationRepository.getConversationByPhone(fromPhone);

  // The AI only extracts *signals* (confirmedUniversity / confirmedInterest) reliably — the exact
  // Message 2 script wording and the actual group/ticket link lookup are done here deterministically,
  // the same way the button-driven path does it, rather than trusting the model's own paraphrase
  // or letting it invent a link for a university it wasn't given.
  let finalReply = aiResult.reply;
  let scriptOverride = null;
  const leadSignals = { confirmedInterest: aiResult.confirmedInterest, confirmedUniversity: aiResult.confirmedUniversity };

  if (aiResult.confirmedUniversity) {
    const resolution = await resolveUniversitySignal(conv, aiResult.confirmedUniversity);

    if (resolution.action === 'ambiguous') {
      finalReply = universityDisambiguationText(resolution.candidates);
      scriptOverride = 'different_uni_ambiguous';
      leadSignals.confirmedUniversity = null; // don't store an unresolved name
    } else if (resolution.action === 'transition') {
      finalReply = resolution.university.groupLink
        ? universityLinkFoundText(resolution.university.groupLink)
        : UNIVERSITY_LINK_NOT_FOUND_TEXT;
      scriptOverride = resolution.university.groupLink ? 'different_uni_link_found' : 'different_uni_link_not_found';
      leadSignals.confirmedUniversity = resolution.university.universityName; // canonical name, not raw AI text
    } else if (resolution.action === 'same') {
      // Already confirmed and unchanged — nothing new to send; let the AI's own reply stand (its
      // facts now reflect this confirmed university, see aiReplyService.js).
      leadSignals.confirmedUniversity = resolution.university.universityName;
    } else {
      // not_found — no link to send, but still record the raw name so admins can see unmet demand.
      leadSignals.confirmedUniversity = resolution.rawName;
    }
  }

  if (!scriptOverride && aiResult.confirmedInterest && !conv?.confirmedInterest) {
    // Newly confirming interest for the first time this conversation — send the ticket link.
    // Prefer the confirmed university's own ticket link over the original campaign contact's,
    // since the student may have already told us they're going somewhere else.
    let ticketLink = null;
    if (conv?.confirmedUniversity) {
      const confirmedUni = await findUniversityLinkExact(conv.confirmedUniversity);
      ticketLink = confirmedUni?.ticketLink || null;
    }
    if (!ticketLink) {
      const payload = parseContactPayload(contactPayloadJson);
      ticketLink = payload.link != null && String(payload.link).trim() ? String(payload.link).trim() : null;
    }
    finalReply = ticketLink ? interestedText(ticketLink) : INTERESTED_NO_LINK_TEXT;
    scriptOverride = ticketLink ? 'interested_ticket_link' : 'interested_no_link';
  }

  // Safety net: even with the transition-only logic above, if a scripted reply happens to match
  // the last outbound message verbatim, don't send it again — fall back to the AI's own reply.
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
  await conversationRepository.applyLeadSignals(fromPhone, leadSignals);

  log.info(
    {
      event: 'meta_reply_ai_generated',
      fromPhone,
      campaignId,
      confirmedInterest: aiResult.confirmedInterest,
      confirmedUniversity: leadSignals.confirmedUniversity,
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
