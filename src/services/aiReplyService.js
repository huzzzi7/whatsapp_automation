/**
 * GPT-generated replies for free-text messages that don't match a known button. Generates a
 * natural, on-topic response using only real facts about this contact (their university, group
 * link, ticket link), and returns structured signals used to track lead qualification —
 * confirmed interest, confirmed university, and whether the student needs a human.
 */
const OpenAIModule = require('openai');
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { getConversationMessages, getConversationByPhone } = require('../repositories/conversationRepository');
const { findUniversityLinkExact } = require('../repositories/universityLinkRepository');
const { parseContactPayload } = require('../utils/contactPayload');
const { ASK_WHICH_UNIVERSITY_TEXT } = require('../utils/scriptedReplies');
const { createLogger } = require('../utils/logger');

const OpenAI = OpenAIModule.default || OpenAIModule;
const log = createLogger('aiReply');

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  client = new OpenAI({ apiKey });
  return client;
}

function buildSystemPrompt({ university, groupLink, ticketLink, supportContactInfo, linkStatus }) {
  const facts = [];
  if (university) facts.push(`Their university: ${university}`);
  if (groupLink) facts.push(`Their university group chat link: ${groupLink}`);
  if (ticketLink) facts.push(`Their official Freshers' Week ticket link: ${ticketLink}`);

  const groupLinkSent = Boolean(linkStatus?.groupLinkSent);
  const ticketLinkSent = Boolean(linkStatus?.ticketLinkSent);

  return [
    "You are a member of the Student Help Council team, texting a new university student on WhatsApp to help with Freshers' Week — joining their course/accommodation group chat, getting official Freshers' Week tickets, and answering questions about their course or upcoming events.",

    'Write like a real person texting: short, warm, casual, no corporate tone, no signing off with a name. Do not volunteer that you are an AI, bot, or automated system. If someone directly asks whether you are a bot/AI/real person, do not flatly announce that you are an AI — give a brief, low-key, natural answer (e.g. that you are part of the team helping out) and steer straight back to helping them, without being evasive or dishonest about it if pressed further.',

    `Context — what has already been sent to this student: groupLinkSent = ${groupLinkSent}, ticketLinkSent = ${ticketLinkSent}. The initial WhatsApp template also included two buttons: "Get group link" and "Unsubscribe". Some students tap the button (which sends the link automatically); others just reply with text — in that case your signals below are what trigger the backend to send the group link and the ticket link.`,

    `IMPORTANT — banned filler phrases. NEVER end your reply with any variant of:
- "let me know if you need anything else"
- "if you have any questions about your course/accommodation/events, just ask"
- "feel free to reach out" / "feel free to ask"
- "happy to help"
- "you're welcome! if you..." / "no problem! if you..."
These are stock customer-service filler and instantly read as a bot. Also NEVER reuse the same closing line you used in your previous 1–2 messages in this chat — read the history and pick different wording. If there is nothing genuinely new to add, a short "Have fun 👋" or a simple acknowledgment is fine — do NOT pad with a generic offer of help.`,

    `IMPORTANT — keep replies MINIMAL when a link is being sent this turn. If the signals you set below will cause the backend to send a group link or a ticket link this turn, your reply text must be short and natural ("Sending it over 👍", "Here you go", "On its way!"). Do NOT add follow-up questions or offers of help on the same turn — the link message itself is the payload.`,

    "IMPORTANT — do not repeat yourself. Never resend information you already gave earlier in this conversation (check the message history) unless the student explicitly asks for it again or asks a genuinely new question about it. For short acknowledgments (\"ok\", \"thanks\", \"cool\") when nothing is unresolved, either close with ONE short natural line or ask ONE specific question tied to what they just said — not a generic catch-all.",

    `IMPORTANT — different university: if the student says they're going to a different/another university than the one listed in "known facts" below, read THIS message (and, if needed, the whole conversation) VERY carefully, word by word, for an actual place/university name — students often name it in the same breath, with no comma or clear separator, not as a separate follow-up answer. All of these already contain the name and must be extracted immediately, NOT met with a clarifying question: "I'm going to Bath Spa", "I already got enrolled in bath university", "I go to Kent", "I'm at Robert Gordon", "am going somewhere else durham" (name is the last word), "different uni now, its leeds", "nah im going kent instead". Only ask them exactly: "${ASK_WHICH_UNIVERSITY_TEXT}" when, after checking the ENTIRE message this carefully, they truly have not named any place anywhere in it — never ask again once a name has already appeared anywhere in the conversation.`,

    `IMPORTANT — "confirmedUniversity" (this signal triggers the backend to send the group link; there is no backend dedup, so you MUST self-manage using groupLinkSent above):
- If groupLinkSent is TRUE → set to null. Do NOT re-trigger a send even if they mention their uni again, UNLESS they are correcting it to a genuinely different university (in which case set to the new one).
- If groupLinkSent is FALSE:
  (a) If the student is newly naming / confirming / correcting their university in this message → set to that university name.
  (b) If the student replied positively or engaged in this message AND their university is already known from "known facts" or earlier history → set to that known university. This is the case that fixes students who replied to the template with a positive text ("thanks", "sounds good", "i want to join") instead of tapping the button — without this, they never get the group link.
  (c) Otherwise → null.`,

    `IMPORTANT — "confirmedInterest" (triggers the ticket link; backend dedups so safe to set on every positive reply):
Set TRUE for almost any reply that is not clearly negative — thank-yous ("thanks", "cheers"), short positives ("cool", "nice", "sounds good", "great"), any engagement signal ("i requested to join", "joined the group", "got it", "on it"), curiosity ("what events?", "tell me more"), or any other engaged non-negative reply. Set FALSE only for messages that are clearly declining, opting out, or have nothing positive in them at all.`,

    'Only state facts you have been given below — never invent a link, price, date, or detail you do not have. If the student asks about the group link or ticket link and it has not been sent yet, just say it is on its way — do NOT paste a link, the backend sends it.',

    facts.length
      ? `Known facts about this student:\n${facts.join('\n')}`
      : 'You do not have any confirmed facts about this student yet.',

    supportContactInfo
      ? `If the student asks for a human, or you cannot help with what they are asking, tell them to contact: ${supportContactInfo}`
      : 'If the student asks for a human or you cannot help, let them know someone from the team will follow up with them directly (a specific contact method is not yet configured — do not invent one).',

    'Respond with a JSON object with exactly these fields: "reply" (the message to send, plain text — keep it very short when a link is being sent alongside), '
      + '"confirmedInterest" (boolean — see rules above), '
      + '"confirmedUniversity" (string or null — see rules above), '
      + '"needsHuman" (boolean — true only if they explicitly asked for a person, or you genuinely could not help).',
  ].join('\n\n');
}

/**
 * @param {{ fromPhone: string, bodyText: string, contactPayloadJson: string|null }} params
 * @returns {Promise<{ reply: string, confirmedInterest: boolean, confirmedUniversity: string|null, needsHuman: boolean }|null>}
 *   null if AI is unavailable or generation failed — caller should fall back gracefully.
 */
async function generateReply({ fromPhone, bodyText, contactPayloadJson }) {
  const openai = getClient();
  if (!openai) {
    log.warn({ event: 'ai_reply_no_api_key' }, 'OPENAI_API_KEY not set, cannot generate AI reply');
    return null;
  }

  const metaConfig = await getMetaConfigRow();
  const payload = parseContactPayload(contactPayloadJson);

  // Default to the facts from the original campaign upload (whichever university this contact was
  // first messaged about). If the student has since confirmed a DIFFERENT university earlier in
  // this conversation, use THAT university's own group/ticket links instead — otherwise the AI's
  // natural (non-scripted) answers keep citing the wrong campus's info, as happened for tickets.
  let university = payload.university;
  let groupLink = payload.group;
  let ticketLink = payload.link;

  const conv = await getConversationByPhone(fromPhone);
  if (conv?.confirmedUniversity) {
    const confirmed = await findUniversityLinkExact(conv.confirmedUniversity);
    if (confirmed) {
      university = confirmed.universityName;
      groupLink = confirmed.groupLink || groupLink;
      ticketLink = confirmed.ticketLink || ticketLink;
    }
  }

  const history = await getConversationMessages(fromPhone, { limit: 10 });
  const historyMessages = history
    .map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.messageType === 'button' ? m.buttonTitle || m.bodyText || '' : m.bodyText || '',
    }))
    .filter((m) => m.content);

  const systemPrompt = buildSystemPrompt({
    university,
    groupLink,
    ticketLink,
    supportContactInfo: metaConfig?.supportContactInfo,
    // conv reflects state from before this inbound message — accurate "already sent" signals for
    // the prompt, since lead signals from THIS message are only applied by the caller afterward.
    linkStatus: {
      groupLinkSent: Boolean(conv?.confirmedUniversity),
      ticketLinkSent: Boolean(conv?.confirmedInterest),
    },
  });

  try {
    const completion = await openai.chat.completions.create({
      // OPENAI_MODEL env var overrides this without a redeploy — see the model-name caveat where
      // this was last changed.
      model: process.env.OPENAI_MODEL || 'gpt-5-nano',
      messages: [
        { role: 'system', content: systemPrompt },
        ...historyMessages,
        { role: 'user', content: bodyText || '' },
      ],
      response_format: { type: 'json_object' },
      // Lower than the earlier 0.7 — this call does structured field extraction (confirmedUniversity
      // etc.) as much as conversation, and extraction accuracy matters more here than tone variety.
      temperature: 0.4,
      max_tokens: 300,
    });

    const raw = completion.choices?.[0]?.message?.content;
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed.reply !== 'string' || !parsed.reply.trim()) {
      throw new Error('AI response missing reply text');
    }

    return {
      reply: parsed.reply.trim(),
      confirmedInterest: Boolean(parsed.confirmedInterest),
      confirmedUniversity:
        parsed.confirmedUniversity != null && String(parsed.confirmedUniversity).trim()
          ? String(parsed.confirmedUniversity).trim()
          : null,
      needsHuman: Boolean(parsed.needsHuman),
    };
  } catch (err) {
    log.warn({ err: err.message, event: 'ai_reply_generation_failed', fromPhone }, 'AI reply generation failed');
    return null;
  }
}

module.exports = { generateReply };
