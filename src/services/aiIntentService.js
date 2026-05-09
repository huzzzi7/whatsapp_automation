const OpenAI = require('openai');
const { detectIntent } = require('../intentEngine');

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

function extractJsonObject(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_) {
    // Try to extract first {...} block (handles accidental extra text / fences)
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function normalizeType(raw) {
  const t = String(raw || '').trim().toUpperCase();
  const allowed = new Set(['NOT_INTERESTED', 'PRICE', 'LOCATION', 'INTERESTED', 'UNKNOWN']);
  return allowed.has(t) ? t : 'UNKNOWN';
}

function mapIntent(type, confidence) {
  const confNum = Number(confidence);
  const conf = Number.isFinite(confNum) ? Math.max(0, Math.min(1, confNum)) : 0;
  const t = normalizeType(type);

  if (t === 'NOT_INTERESTED') {
    // Safety gate: never stop unless high confidence
    if (conf >= 0.85) {
      return { type: 'NOT_INTERESTED', reply: 'No worries xx.', stopSequence: true };
    }
    return { type: 'UNKNOWN', reply: null, stopSequence: false };
  }
  if (t === 'PRICE') {
    return { type: 'PRICE', reply: null, stopSequence: false };
  }
  if (t === 'LOCATION') {
    return { type: 'LOCATION', reply: null, stopSequence: false };
  }
  if (t === 'INTERESTED') {
    return { type: 'INTERESTED', reply: null, stopSequence: false };
  }
  return { type: 'UNKNOWN', reply: null, stopSequence: false };
}

async function detectIntentAi(text) {
  try {
    if (!isAiEnabled()) return detectIntent(text);

    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) return detectIntent(text);

    const model = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
    const timeoutMs = process.env.AI_TIMEOUT_MS;

    const systemPrompt = `You are an intent classifier for WhatsApp messages in a university student recruitment campaign.
Classify the user message into EXACTLY one of these types:
- NOT_INTERESTED: user wants to stop, opt out, says no, unsubscribe, stop, remove me, not interested
- PRICE: user asks about salary, pay, income, money, kitna, paisa
- LOCATION: user asks about where, location, country, kahan
- INTERESTED: user says yes, ok, interested, tell me more, details, sure, sounds good
- UNKNOWN: anything else, casual reply, question not listed above
IMPORTANT: Only classify as NOT_INTERESTED if the user clearly wants to stop receiving messages.
Never classify ambiguous messages as NOT_INTERESTED.
Respond ONLY with valid JSON in this exact format, no other text:
{ "type": <TYPE>, "confidence": <0.0-1.0> }`;

    const call = getOpenAiClient().chat.completions.create({
      model,
      max_tokens: 60,
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: String(text || '') },
      ],
    });

    const resp = await withTimeout(call, timeoutMs, 'ai_intent_timeout');
    const content = resp?.choices?.[0]?.message?.content;
    const parsed = extractJsonObject(content);
    const type = parsed && typeof parsed === 'object' ? parsed.type : 'UNKNOWN';
    const confidence = parsed && typeof parsed === 'object' ? parsed.confidence : 0;

    const mapped = mapIntent(type, confidence);
    console.log('[AI Intent]', {
      type: mapped.type,
      confidence: Number(confidence) || 0,
      text: String(text || '').slice(0, 50),
    });
    return mapped;
  } catch (err) {
    console.error('[AI Intent] failed, falling back to keyword rules:', err?.message || String(err));
    return detectIntent(text);
  }
}

module.exports = { detectIntentAi };

