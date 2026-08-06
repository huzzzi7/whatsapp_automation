/**
 * GPT-generated replies for free-text messages that don't match a known button. Generates a
 * natural, on-topic response using only real facts about this contact (their university, group
 * link, ticket link), and returns structured signals used to track lead qualification —
 * confirmed interest, confirmed university, and whether the student needs a human.
 */
const OpenAIModule = require('openai');
const { getMetaConfigRow } = require('../repositories/metaConfigRepository');
const { getConversationMessages } = require('../repositories/conversationRepository');
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

function parseContactPayload(payloadJson) {
  if (payloadJson == null || payloadJson === '') return {};
  try {
    const obj = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function buildSystemPrompt({ university, groupLink, ticketLink, supportContactInfo }) {
  const facts = [];
  if (university) facts.push(`Their university: ${university}`);
  if (groupLink) facts.push(`Their university group chat link: ${groupLink}`);
  if (ticketLink) facts.push(`Their official Freshers' Week ticket link: ${ticketLink}`);

  return [
    "You are a friendly, casual assistant for a Student Help Council helping new university students with Freshers' Week — joining their course/accommodation group chat and getting official Freshers' Week tickets.",
    'Write like a real person texting on WhatsApp: short, warm, casual, no corporate tone, no signing off with a name.',
    'Only state facts you have been given below — never invent a link, price, date, or detail you do not have.',
    facts.length
      ? `Known facts about this student:\n${facts.join('\n')}`
      : 'You do not have any confirmed facts about this student yet.',
    supportContactInfo
      ? `If the student asks for a human, or you cannot help with what they are asking, tell them to contact: ${supportContactInfo}`
      : 'If the student asks for a human or you cannot help, let them know someone from the team will follow up with them directly (a specific contact method is not yet configured — do not invent one).',
    'Respond with a JSON object with exactly these fields: "reply" (the message to send, plain text), '
      + '"confirmedInterest" (boolean — true only if they clearly said they want to join / are interested), '
      + '"confirmedUniversity" (string or null — the university they confirmed or corrected, otherwise null), '
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

  const history = await getConversationMessages(fromPhone, { limit: 10 });
  const historyMessages = history
    .map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.messageType === 'button' ? m.buttonTitle || m.bodyText || '' : m.bodyText || '',
    }))
    .filter((m) => m.content);

  const systemPrompt = buildSystemPrompt({
    university: payload.university,
    groupLink: payload.group,
    ticketLink: payload.link,
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
      temperature: 0.7,
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
