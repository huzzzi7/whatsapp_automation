const OpenAI = require('openai');

let client = null;

function isAiEnabled() {
  return String(process.env.AI_ENABLED || '').trim().toLowerCase() === 'true';
}

function getOpenAiClient() {
  if (client) return client;
  client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function withTimeout(promise, timeoutMs, label) {
  const msRaw = Math.floor(Number(timeoutMs));
  const ms = Number.isFinite(msRaw) && msRaw > 0 ? msRaw : 15000;
  let t;
  const timeoutPromise = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label || 'timeout'} after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(t));
}

function optOutSignal(text) {
  const s = String(text || '').toLowerCase();
  return /\b(stop|unsubscribe|not interested|remove me|dont want|don't want)\b/i.test(s);
}

/**
 * @param {object} params
 * @param {string} params.incomingText
 * @param {string} params.intentType
 * @param {object|null} params.userState
 * @param {string} params.phoneDigits
 * @param {string} params.greenInstanceDbId
 * @param {object|null|undefined} params.contactData
 * @param {string[]|undefined} params.recentInbound
 * @param {string|undefined} params.lastSequenceMessageSent - scripted template just sent this inbound turn
 * @returns {Promise<{ replyText: string|null, blockSequence: boolean, error: string|null }>}
 */
async function generateAiReply({
  incomingText,
  intentType,
  userState,
  phoneDigits,
  greenInstanceDbId,
  contactData,
  recentInbound,
  lastSequenceMessageSent,
}) {
  try {
    if (!isAiEnabled()) return { replyText: null, blockSequence: false, error: null };
    if (String(process.env.OPENAI_API_KEY || '').trim() === '')
      return { replyText: null, blockSequence: false, error: null };

    const type = String(intentType || '').trim().toUpperCase();
    if (type === 'NOT_INTERESTED') return { replyText: null, blockSequence: false, error: null };

    const status = userState && userState.status != null ? String(userState.status).trim().toLowerCase() : '';
    if (status === 'stopped') return { replyText: null, blockSequence: false, error: null };

    const text = String(incomingText || '').trim();
    if (!text) return { replyText: null, blockSequence: false, error: null };

    if (optOutSignal(text)) return { replyText: null, blockSequence: true, error: null };

    const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
    const maxTokensRaw = parseInt(String(process.env.AI_MAX_TOKENS || '200'), 10);
    const maxTokens = Number.isFinite(maxTokensRaw) ? Math.max(50, Math.min(800, maxTokensRaw)) : 200;
    const tempRaw = parseFloat(String(process.env.AI_TEMPERATURE || '0.7'));
    const temperature = Number.isFinite(tempRaw) ? Math.max(0, Math.min(1.5, tempRaw)) : 0.7;
    const timeoutMs = process.env.AI_TIMEOUT_MS;

    const step = userState && Number.isFinite(Number(userState.lastSentIndex)) ? Math.floor(Number(userState.lastSentIndex)) : 0;
    const university = contactData?.university || 'uni';

    let toneInstruction;
    if (step <= 2) {
      toneInstruction =
        'You are just getting to know them. Be curious and casual. Ask one question back.';
    } else if (step <= 4) {
      toneInstruction =
        'You are warming up. Be friendly and mention you have found some good groups.';
    } else {
      toneInstruction =
        'You are close enough to invite them. Mention the group or event naturally like a friend would.';
    }

    const historyLines =
      (Array.isArray(recentInbound) ? recentInbound : [])
        .slice(-3)
        .map((t, i) => `  [${i + 1}] ${t}`)
        .join('\n') || '  (no prior messages)';

    const systemPrompt = [
      'You are Alex, a 20-year-old university student who just transferred to a new campus.',
      `You are studying at ${university} and genuinely excited to meet people and find your crowd.`,
      'You text like a real student: casual, warm, curious, occasionally funny.',
      'You use light emojis naturally — not in every message, just when it fits.',
      'You are NOT an AI. Never say you are a bot, AI, or automated system.',
      'If someone asks if you are a bot or AI, laugh it off naturally like a real person would.',
      'Never sound like a recruiter, promoter, or assistant.',
      'Never mention company names, ticket prices, or formal event names.',
      toneInstruction,
      'Reply only with the message text — no quotes, no labels, no explanations.',
    ].join(' ');

    const seqLine =
      lastSequenceMessageSent != null && String(lastSequenceMessageSent).trim() !== ''
        ? String(lastSequenceMessageSent).trim()
        : '(none — template did not send this turn)';
    const userContent = [
      `University context: ${university}`,
      `Conversation step: ${step} of 6`,
      `Last scripted template message we sent them just before you reply (follow its vibe; do not contradict it): ${seqLine}`,
      `Recent messages from this user:\n${historyLines}`,
      `Their latest message: ${text}`,
      `Intent: ${type}`,
    ].join('\n');

    const call = getOpenAiClient().chat.completions.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    });

    const resp = await withTimeout(call, timeoutMs, 'ai_reply_timeout');
    const raw = resp?.choices?.[0]?.message?.content != null ? String(resp.choices[0].message.content) : '';
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed) return { replyText: null, blockSequence: false, error: null };

    const words = trimmed.split(/\s+/).filter(Boolean);
    let capped = trimmed;
    if (words.length > 40) {
      // Trim to last complete sentence within 40 words
      const first40 = words.slice(0, 40).join(' ');
      const sentenceEnd = first40.search(/[.!?][^.!?]*$/);
      capped = sentenceEnd > 0 ? first40.slice(0, sentenceEnd + 1).trim() : first40;
    }

    const finalReply = capped
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!finalReply) return { replyText: null, blockSequence: false, error: null };

    if (optOutSignal(finalReply)) {
      return { replyText: null, blockSequence: true, error: null };
    }

    console.log('[AI Reply]', {
      intentType: type,
      replyText: finalReply.slice(0, 50),
      phoneDigits,
      greenInstanceDbId,
    });

    return { replyText: finalReply, blockSequence: false, error: null };
  } catch (err) {
    console.error('[AI Reply] failed (no reply sent, sequence continues):', err?.message || String(err));
    return { replyText: null, blockSequence: false, error: err?.message || String(err) };
  }
}

module.exports = { generateAiReply };
