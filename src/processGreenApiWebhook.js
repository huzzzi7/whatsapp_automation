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
const { sendMessage } = require('./greenapi');
const { detectIntent } = require('./intentEngine');
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
 * Dedupe: prefer instance+phone+providerMessageId when id present.
 * Empty inbound text + no id: instance+phone+empty+bucket (avoid hashing only '' for all media in same bucket).
 * @param {string} greenInstanceDbId
 * @param {string} phone
 * @param {string} text
 * @param {number} timestamp
 * @param {string|null|undefined} providerMessageId
 */
function buildDedupeKey(greenInstanceDbId, phone, text, timestamp, providerMessageId) {
  const gid = String(greenInstanceDbId || '').trim();
  const p = String(phone || '').trim();
  const id = providerMessageId != null ? String(providerMessageId).trim() : '';
  if (id) {
    return crypto.createHash('md5').update(`${gid}:${p}:${id}`, 'utf8').digest('hex');
  }
  const normalizedText = String(text ?? '').trim().toLowerCase();
  const bucket = roundedTimestampBucket(timestamp);
  if (normalizedText === '') {
    const input = `${gid}:${p}:empty:${bucket}`;
    return crypto.createHash('md5').update(input, 'utf8').digest('hex');
  }
  const input = `${gid}:${p}:${normalizedText}:${bucket}`;
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

async function processGreenApiWebhook(rawBuffer, greenInstanceDbId) {
  console.log('[WEBHOOK_DEBUG] processGreenApiWebhook entry', {
    greenInstanceDbId,
    rawBytes: Buffer.isBuffer(rawBuffer) ? rawBuffer.length : 0,
  });
  console.log('[Webhook] Instance:', greenInstanceDbId);
  console.log('[WEBHOOK_DEBUG] Instance resolution result:', greenInstanceDbId);

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
  console.log('[WEBHOOK_DEBUG] Incoming webhook body:', JSON.stringify(body).slice(0, 2000));
  console.log('[Webhook] Raw body:', JSON.stringify(body).slice(0, 300));
  console.log('[Webhook] Body keys:', Object.keys(body).join(', '));
  const parsed = parseIncomingNotification(body);
  if (!parsed || !parsed.phone) {
    console.log('[Webhook] Ignored notification (unparsed or no phone)');
    console.log('[Webhook] Payload preview:', JSON.stringify(body).slice(0, 200));
    return;
  }

  const rawProviderId =
    parsed.providerMessageId != null && String(parsed.providerMessageId).trim() !== ''
      ? String(parsed.providerMessageId).trim()
      : '';
  const dedupeKey = buildDedupeKey(
    greenInstanceDbId,
    parsed.phone,
    parsed.text,
    parsed.timestamp,
    rawProviderId || null,
  );
  const providerForDb = rawProviderId || `noid-${dedupeKey}`;

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
    console.log('[DEDUPE_RESULT] skipped duplicate_key');
    console.log('[Webhook] Duplicate blocked via dedupe_key');
    return;
  }
  console.log('[DEDUPE_RESULT] inserted');

  const intent = detectIntent(parsed.text);
  console.log(
    '[INTENT_RESULT]',
    `type=${intent.type} stopSequence=${intent.stopSequence} reply=${intent.reply ? 'yes' : 'no'}`,
  );

  const norm = String(parsed.phone || '').replace(/\D/g, '');
  const keyVariants = [...new Set([norm, norm.replace(/^0+/, '')].filter((k) => k && k.length > 0))];

  async function persistStoppedStatus() {
    for (const key of keyVariants) {
      const prod = await Promise.resolve(state.getState(greenInstanceDbId, key));
      if (prod) {
        state.setState(greenInstanceDbId, key, { ...prod, status: 'stopped' });
        return;
      }
      const tst = testState.getState(greenInstanceDbId, key);
      if (tst) {
        testState.setState(greenInstanceDbId, key, { ...tst, status: 'stopped' });
        return;
      }
    }
  }

  if (intent.stopSequence === true) {
    console.log('[STOP_TRIGGERED] true');
    if (intent.reply && parsed.chatId) {
      try {
        await sendMessage(parsed.chatId, intent.reply, greenApi);
      } catch (err) {
        console.error('[Intent] sendMessage failed:', err.message);
      }
    }
    await persistStoppedStatus();
    console.log('[Intent] Sequence stopped for', parsed.phone);
    return;
  }
  console.log('[STOP_TRIGGERED] false');

  if (intent.reply && parsed.chatId) {
    try {
      await sendMessage(parsed.chatId, intent.reply, greenApi);
      console.log('[Intent] Custom reply sent');
    } catch (err) {
      console.error('[Intent] Custom reply send failed:', err.message);
    }
  } else {
    console.log('[Intent] No match, fallback to sequence');
  }

  const replyOpts = {
    greenApi,
    greenInstanceDbId,
    incomingText: parsed.text,
    lastIntentType: intent.type,
  };

  console.log('[Webhook] Parsed phone:', parsed.phone);
  let hasTest = false;
  let hasProd = false;
  for (const key of keyVariants) {
    if (testState.getState(greenInstanceDbId, key)) hasTest = true;
    if (await Promise.resolve(state.getState(greenInstanceDbId, key))) hasProd = true;
  }
  console.log('[Webhook] Test state exists:', hasTest);
  console.log('[Webhook] Prod state exists:', hasProd);
  console.log('[REPLYFLOW_CHECK]', {
    hasTest,
    hasProd,
    phone: parsed.phone,
    keyVariants,
    instanceId: greenInstanceDbId,
  });
  if (!hasTest && !hasProd) {
    console.log('[REPLYFLOW_SKIPPED_REASON]', {
      reason: !hasProd && !hasTest ? 'no_conversation_state' : 'unknown',
    });
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
    console.log('[REPLY_FLOW] executing test path');
    await onIncomingReplyTest(parsed.phone, replyOpts);
  } else if (hasProd) {
    console.log('[REPLY_FLOW] executing prod path');
    await onIncomingReply(parsed.phone, replyOpts);
  } else {
    console.log('[REPLY_FLOW] skipped reason=no_conversation_state');
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
