/**
 * Shared Green API webhook processing: parse notification, route test vs prod reply flow.
 * @param {Buffer} rawBuffer
 * @param {string} greenInstanceDbId - green_instances.id
 */
const crypto = require('crypto');
const pool = require('./mysql');
const { parseIncomingNotification } = require('./receive');
const { onIncomingReply, onIncomingReplyTest } = require('./replyFlow');
const { resolveGreenApiConfig } = require('./greenInstance');
const state = require('./state');
const testState = require('./testState');
const { insertIncomingMessage } = require('./repositories/incomingMessageRepository');

/**
 * Green API timestamps are usually Unix seconds; Date.now() is ms. Normalize to ms then bucket by 5s.
 * @param {number} rawTs
 */
function roundedTimestampBucket(rawTs) {
  let t = Number(rawTs);
  if (!Number.isFinite(t)) {
    t = Date.now();
  }
  const ms = t < 1e12 ? Math.round(t * 1000) : Math.round(t);
  return Math.floor(ms / 5000);
}

/**
 * @param {string} greenInstanceDbId
 * @param {string} phone
 * @param {string} text
 * @param {number} timestamp
 */
function buildDedupeKey(greenInstanceDbId, phone, text, timestamp) {
  const normalizedText = String(text ?? '').trim().toLowerCase();
  const bucket = roundedTimestampBucket(timestamp);
  const input = `${String(greenInstanceDbId).trim()}:${String(phone).trim()}:${normalizedText}:${bucket}`;
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

async function processGreenApiWebhook(rawBuffer, greenInstanceDbId) {
  console.log('[Webhook] Instance:', greenInstanceDbId);

  const [rows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [greenInstanceDbId]);
  const row = rows[0];
  if (!row) {
    console.error('[Webhook] Unknown greenInstanceDbId:', greenInstanceDbId);
    return;
  }
  const greenApi = resolveGreenApiConfig(row);

  let body = null;
  if (Buffer.isBuffer(rawBuffer) && rawBuffer.length > 0) {
    try {
      body = JSON.parse(rawBuffer.toString('utf8'));
    } catch (e) {
      console.error('[Webhook] Failed to parse raw body');
      return;
    }
  }
  if (!body || typeof body !== 'object') {
    console.log('[Webhook] Body keys: (empty or invalid)');
    return;
  }
  console.log('[Webhook] Raw body:', JSON.stringify(body).slice(0, 300));
  console.log('[Webhook] Body keys:', Object.keys(body).join(', '));
  const parsed = parseIncomingNotification(body);
  if (!parsed || !parsed.phone) {
    console.log('[Webhook] Ignored notification (unparsed or no phone)');
    console.log('[Webhook] Payload preview:', JSON.stringify(body).slice(0, 200));
    return;
  }

  const dedupeKey = buildDedupeKey(greenInstanceDbId, parsed.phone, parsed.text, parsed.timestamp);
  const providerForDb =
    parsed.providerMessageId != null && String(parsed.providerMessageId).trim() !== ''
      ? String(parsed.providerMessageId).trim()
      : `noid-${dedupeKey}`;

  console.log('[Webhook Debug]', {
    phone: parsed.phone,
    text: parsed.text,
    providerMessageId: parsed.providerMessageId,
    typeWebhook: parsed.typeWebhook,
    timestamp: parsed.timestamp,
    dedupeKey,
  });

  let insertResult;
  try {
    insertResult = await insertIncomingMessage({
      greenInstanceDbId,
      providerMessageId: providerForDb,
      typeWebhook: parsed.typeWebhook,
      phone: parsed.phone,
      dedupeKey,
    });
  } catch (err) {
    console.error('[Webhook] incoming_messages_log insert failed:', err.message);
    return;
  }
  if (!insertResult.inserted) {
    console.log('[Webhook] Duplicate blocked via dedupe_key');
    return;
  }

  console.log('[Webhook] Parsed phone:', parsed.phone);
  const norm = String(parsed.phone || '').replace(/\D/g, '');
  const keyVariants = [...new Set([norm, norm.replace(/^0+/, '')].filter((k) => k && k.length > 0))];
  let hasTest = false;
  let hasProd = false;
  for (const key of keyVariants) {
    if (testState.getState(greenInstanceDbId, key)) hasTest = true;
    if (await Promise.resolve(state.getState(greenInstanceDbId, key))) hasProd = true;
  }
  console.log('[Webhook] Test state exists:', hasTest);
  console.log('[Webhook] Prod state exists:', hasProd);
  if (!hasTest && !hasProd) {
    const preview = JSON.stringify(body).slice(0, 500);
    console.warn('[Automation BLOCKED] No conversation state found', {
      greenInstanceDbId,
      phone: norm,
      suggestion:
        'Ensure the first message was sent via /api/campaign/start, /api/campaign/test-start, /api/campaign/test-message, or /api/send (reply mode); check phone normalization matches.',
    });
    console.warn('[Webhook] Payload preview (500 chars):', preview);
  }
  console.log('[Webhook] Comparing instanceId with state keys');
  console.log('[Webhook] Prod state keys:', Object.keys(state.loadState()));
  console.log('[Webhook] Test state keys:', Object.keys(testState.loadState()));
  if (hasTest) {
    await onIncomingReplyTest(parsed.phone, { greenApi, greenInstanceDbId });
  } else if (hasProd) {
    await onIncomingReply(parsed.phone, { greenApi, greenInstanceDbId });
  }
}

/**
 * Map Green API webhook JSON to green_instances.id using instanceData.idInstance.
 * @param {object|null} body - parsed top-level webhook body
 * @returns {Promise<string|null>}
 */
async function resolveGreenInstanceDbIdFromWebhookBody(body) {
  if (!body || typeof body !== 'object') return null;
  const payload = body.body || body;
  const idInstance = payload?.instanceData?.idInstance;
  if (idInstance == null) return null;
  const [rows] = await pool.execute(
    'SELECT id FROM green_instances WHERE greenInstanceId = ? LIMIT 1',
    [String(idInstance)],
  );
  const row = rows[0];
  return row ? row.id : null;
}

module.exports = { processGreenApiWebhook, resolveGreenInstanceDbIdFromWebhookBody };
