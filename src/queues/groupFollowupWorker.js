/**
 * Consumes groupFollowupQueue: fires a few minutes after a contact taps "Get Group Link" and
 * sends the ticket link, the same way aiReplyWorker follows up on confirmed interest. Runs in the
 * same process as coordinatorWorker (required from there) so no extra PM2 process is needed.
 */
const { Worker } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { findUniversityLinkExact } = require('../repositories/universityLinkRepository');
const conversationRepository = require('../repositories/conversationRepository');
const { sendReplyText } = require('../services/replySequence');
const { parseContactPayload } = require('../utils/contactPayload');
const { INTERESTED_NO_LINK_TEXT, interestedText } = require('../utils/scriptedReplies');
const { createLogger } = require('../utils/logger');

const log = createLogger('groupFollowupWorker');

async function processGroupFollowupJob(job) {
  const { fromPhone, campaignId, contactPayloadJson } = job.data;

  const metaConfig = await getMetaConfigRow();
  if (!metaConfig || !metaConfig.isEnabled) {
    log.warn(
      { event: 'group_followup_send_skipped_no_config', fromPhone },
      'Meta config missing/disabled, cannot send follow-up',
    );
    return;
  }

  const conv = await conversationRepository.getConversationByPhone(fromPhone);

  // Prefer the confirmed university's own ticket link over the original campaign contact's, since
  // the student may have told us they're going somewhere else in the meantime.
  let ticketLink = null;
  if (conv?.confirmedUniversity) {
    const confirmedUni = await findUniversityLinkExact(conv.confirmedUniversity);
    ticketLink = confirmedUni?.ticketLink || null;
  }
  if (!ticketLink) {
    const payload = parseContactPayload(contactPayloadJson);
    ticketLink = payload.link != null && String(payload.link).trim() ? String(payload.link).trim() : null;
  }

  const text = ticketLink ? interestedText(ticketLink) : INTERESTED_NO_LINK_TEXT;

  // If the ticket link already went out in the meantime (e.g. the AI path sent it after a "thanks"
  // reply that arrived before this job fired), don't send the exact same text again.
  const recentHistory = await conversationRepository.getConversationMessages(fromPhone, { limit: 5 });
  const lastOutbound = [...recentHistory].reverse().find((m) => m.direction === 'outbound');
  if (lastOutbound && lastOutbound.bodyText === text) {
    log.info(
      { event: 'group_followup_deduped', fromPhone, campaignId },
      'Ticket link already sent as the most recent message, skipping duplicate follow-up',
    );
    return;
  }

  await sendReplyText(fromPhone, text, campaignId, 'system');

  log.info(
    { event: 'group_followup_sent', fromPhone, campaignId, hasTicketLink: Boolean(ticketLink) },
    'group_followup_sent',
  );
}

const groupFollowupWorker = new Worker('groupFollowupQueue', processGroupFollowupJob, {
  connection: bullMqConnection,
  concurrency: 5,
  skipVersionCheck: bullMqSkipVersionCheck,
});

groupFollowupWorker.on('error', (err) =>
  log.error({ err: err.message, event: 'group_followup_worker_error' }, 'groupFollowupWorker error'),
);
groupFollowupWorker.on('failed', (job, err) =>
  log.error(
    { err: err.message, bullJobId: job?.id, fromPhone: job?.data?.fromPhone, event: 'group_followup_job_failed' },
    'Group follow-up job failed permanently',
  ),
);

log.info(
  { event: 'group_followup_worker_started', queue: 'groupFollowupQueue', concurrency: 5 },
  'groupFollowupWorker started',
);

async function closeGroupFollowupWorker() {
  await groupFollowupWorker.close();
  log.info({ event: 'group_followup_worker_closed' }, 'groupFollowupWorker closed');
}

module.exports = { groupFollowupWorker, closeGroupFollowupWorker };
