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

function buildSystemPrompt({ university, groupLink, ticketLink, supportContactInfo }) {
  const facts = [];
  if (university) facts.push(`Their university: ${university}`);
  if (groupLink) facts.push(`Their university group chat link: ${groupLink}`);
  if (ticketLink) facts.push(`Their official Freshers' Week ticket link: ${ticketLink}`);

  return [
    "You are a member of the Student Help Council team, texting a new university student on WhatsApp to help with Freshers' Week — joining their course/accommodation group chat, getting official Freshers' Week tickets, and answering questions about their course or upcoming events.",
    'Write like a real person texting: short, warm, casual, no corporate tone, no signing off with a name. Do not volunteer that you are an AI, bot, or automated system. If someone directly asks whether you are a bot/AI/real person, do not flatly announce that you are an AI — give a brief, low-key, natural answer (e.g. that you are part of the team helping out) and steer straight back to helping them, without being evasive or dishonest about it if pressed further.',
    "IMPORTANT — do not repeat yourself: never resend a link or repeat information you already gave earlier in this conversation (check the message history) unless the student explicitly asks for it again or asks a genuinely new question about it. If their message is just a short acknowledgment (e.g. \"ok\", \"thanks\", \"cool\", \"got it\") and nothing is unresolved, do not repeat previous info — just close the loop briefly and ask if they have any questions about their course, accommodation, or upcoming Freshers' Week events.",
    `IMPORTANT — different university: if the student says they're going to a different/another university than the one listed in "known facts" below, read THIS message (and, if needed, the whole conversation) VERY carefully, word by word, for an actual place/university name — students often name it in the same breath, with no comma or clear separator, not as a separate follow-up answer. All of these already contain the name and must be extracted immediately, NOT met with a clarifying question: "I'm going to Bath Spa", "I already got enrolled in bath university", "I go to Kent", "I'm at Robert Gordon", "am going somewhere else durham" (name is the last word), "different uni now, its leeds", "nah im going kent instead". Only ask them exactly: "${ASK_WHICH_UNIVERSITY_TEXT}" when, after checking the ENTIRE message this carefully, they truly have not named any place anywhere in it — never ask again once a name has already appeared anywhere in the conversation.`,
    'IMPORTANT — "confirmedUniversity" is a per-message signal, not a standing fact: set it ONLY on the message where the student is newly naming/confirming/correcting their university. On later messages (thanks, acknowledgments, unrelated questions) where they are not restating it, set it to null — even though you still know their university from "known facts" or history, do not keep re-emitting it, since doing so re-sends the join link on every single reply.',
    'IMPORTANT — offering tickets: the student should NOT have to explicitly say "interested" or ask for tickets by name to be offered them. Set "confirmedInterest" true for almost any reply that is not clearly negative — a thank-you, a short positive reply ("cool", "nice", "sounds good"), curiosity about events/the uni ("what events?", "tell me more"), or any other engaged, non-negative response all count. Only leave it false for a message that is clearly declining/not interested, an opt-out, or has nothing positive in it at all. Like confirmedUniversity, this is a per-message signal — a system elsewhere tracks whether tickets were already offered and only sends the link on the first positive reply, so you do not need to hold back on later messages to avoid repeating it; just report what THIS message shows.',
    'Only state facts you have been given below — never invent a link, price, date, or detail you do not have.',
    facts.length
      ? `Known facts about this student:\n${facts.join('\n')}`
      : 'You do not have any confirmed facts about this student yet.',
    supportContactInfo
      ? `If the student asks for a human, or you cannot help with what they are asking, tell them to contact: ${supportContactInfo}`
      : 'If the student asks for a human or you cannot help, let them know someone from the team will follow up with them directly (a specific contact method is not yet configured — do not invent one).',
    'Respond with a JSON object with exactly these fields: "reply" (the message to send, plain text), '
      + '"confirmedInterest" (boolean — see above: true for almost any positive/engaged reply, not just an explicit "yes I\'m interested"), '
      + '"confirmedUniversity" (string or null — see above: only non-null on the message that newly names/confirms/corrects it), '
      + '"needsHuman" (boolean — true if they explicitly asked for a person, or you could not help).',
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
  });

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
