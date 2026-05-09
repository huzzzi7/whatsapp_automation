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
 * @returns {Promise<{ replyText: string|null, blockSequence: boolean, error: string|null }>}
 */
async function generateAiReply({ incomingText, intentType, userState, phoneDigits, greenInstanceDbId }) {
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

    // Hard safety: if inbound itself is opt-out-ish, don't proceed with AI reply here.
    if (optOutSignal(text)) return { replyText: null, blockSequence: true, error: null };

    const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
    const maxTokensRaw = parseInt(String(process.env.AI_MAX_TOKENS || '200'), 10);
    const maxTokens = Number.isFinite(maxTokensRaw) ? Math.max(50, Math.min(500, maxTokensRaw)) : 200;
    const tempRaw = parseFloat(String(process.env.AI_TEMPERATURE || '0.7'));
    const temperature = Number.isFinite(tempRaw) ? Math.max(0, Math.min(1.5, tempRaw)) : 0.7;
    const timeoutMs = process.env.AI_TIMEOUT_MS;

    const step = userState && Number.isFinite(Number(userState.lastSentIndex)) ? Math.floor(Number(userState.lastSentIndex)) : 0;

    const systemPrompt = [
      'You are a friendly assistant responding to WhatsApp messages.',
      'Keep replies short (under 15 words), casual, and natural.',
      'Do not use formal language. Do not mention company names or locations.',
      'Match the tone of the conversation.',
      'Reply only with the message text — no quotes, no labels.',
    ].join(' ');

    const userContent = `Student replied: ${text}
Conversation context: step ${step} of 6
Intent detected: ${type}`;

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
    const replyText = raw.trim().replace(/\s+/g, ' ');
    if (!replyText) return { replyText: null, blockSequence: false, error: null };

    // Hard cap: truncate to 15 words max
    const words = replyText.split(/\s+/).filter(Boolean);
    const capped = words.length > 15 ? words.slice(0, 15).join(' ') : replyText;
    const finalReply = capped
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!finalReply) return { replyText: null, blockSequence: false, error: null };

    // If model output accidentally contains opt-out signal, don't send; optionally stop sequence.
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

