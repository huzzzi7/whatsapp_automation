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
const { enqueueMessage } = require('./queues/enqueueMessage');
const { detectIntentAi } = require('./services/aiIntentService');
const { generateAiReply } = require('./services/aiReplyService');
const state = require('./state');
const testState = require('./testState');
const { insertIncomingMessage } = require('./repositories/incomingMessageRepository');
const { clearAllQueuesForInstance } = require('./services/instanceQueueGuard');
const { updateInboundMeta, appendInboundHistory } = require('./repositories/conversationStateRepository');
const { getContactPayloadByPhone } = require('./repositories/campaignRepository');
const { logger } = require('./utils/logger');

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
async function getPipelineMetaForPhone(greenInstanceDbId, keyVariants) {
  for (const key of keyVariants) {
    const prod = await Promise.resolve(state.getState(greenInstanceDbId, key));
    if (prod) {
      const idx = Math.floor(Number(prod.lastSentIndex));
      return {
        messageCount: Number.isFinite(idx) && idx >= 0 ? idx : 0,
        lastMessageAt: prod.lastOutboundAt,
      };
    }
    const tst = testState.getState(greenInstanceDbId, key);
    if (tst) {
      const idx = Math.floor(Number(tst.lastSentIndex));
      return {
        messageCount: Number.isFinite(idx) && idx >= 0 ? idx : 0,
        lastMessageAt: tst.lastOutboundAt,
      };
    }
  }
  return { messageCount: 0, lastMessageAt: undefined };
}

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

  const webhookType = body?.typeWebhook || body?.body?.typeWebhook || '';
  if (webhookType === 'statusInstanceChanged' || webhookType === 'stateInstanceChanged') {
    const instanceStatus = body?.body?.stateInstance || body?.stateInstance || '';
    console.log(
      `[Webhook] Instance status changed: instanceId=${greenApi.instanceId} status=${instanceStatus}`,
    );
    const { isAuthorizedGreenInstanceState } = require('./utils/greenInstanceAuthState');

    // Update DB auth status from webhook event
    try {
      const { recalculateActiveCampaigns } = require('./services/campaignRecalculator');
      const newIsActive = isAuthorizedGreenInstanceState(instanceStatus) ? 1 : 0;
      const [rows2] = await pool.execute('SELECT isActive FROM green_instances WHERE id = ? LIMIT 1', [
        greenInstanceDbId,
      ]);
      const prevIsActive = rows2[0]?.isActive;
      await pool.execute(
        `UPDATE green_instances
         SET authStatus = ?, isActive = IF(manualDisabled = 1, 0, ?), statusCheckedAt = NOW()
         WHERE id = ?`,
        [String(instanceStatus).slice(0, 50), newIsActive, greenInstanceDbId]
      );
      const activeFlipped = Number(prevIsActive) !== Number(newIsActive);
      if (activeFlipped && newIsActive === 0) {
        try {
          await clearAllQueuesForInstance(row, 'instance_unauthorized');
        } catch (err) {
          logger.error(
            { event: 'instance_unauthorized_clear_failed', greenInstanceDbId, err: err?.message || String(err) },
            'Clear queues on unauthorized failed',
          );
        }
      }
      if (activeFlipped) {
        await recalculateActiveCampaigns();
      }
    } catch (err) {
      console.error('[Webhook] Failed to update instance auth status in DB:', err.message);
    }
    return;
  }

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

  const norm = String(parsed.phone || '').replace(/\D/g, '');
  const keyVariants = [...new Set([norm, norm.replace(/^0+/, '')].filter((k) => k && k.length > 0))];

  // Best-effort: record inbound timestamp for follow-up cancellation
  try {
    await updateInboundMeta(greenInstanceDbId, parsed.phone, { lastInboundAt: Date.now() });
  } catch (err) {
    logger.warn('[Webhook] updateInboundMeta failed (non-fatal):', err.message);
  }

  try {
    const trimmedInbound = String(parsed.text || '').trim();
    if (trimmedInbound) {
      await appendInboundHistory(greenInstanceDbId, norm, trimmedInbound);
    }
  } catch (err) {
    logger.warn('[Webhook] appendInboundHistory failed (non-fatal):', err.message);
  }

  const intent = await detectIntentAi(parsed.text);
  let intentReplySent = false;
  console.log(
    '[INTENT_RESULT]',
    `type=${intent.type} stopSequence=${intent.stopSequence} reply=${intent.reply ? 'yes' : 'no'}`,
  );

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
        const meta = await getPipelineMetaForPhone(greenInstanceDbId, keyVariants);
        const stopSend = await enqueueMessage(
          {
            instanceId: greenApi.instanceId,
            apiToken: greenApi.apiToken,
            baseUrl: greenApi.baseUrl,
            chatId: parsed.chatId,
            message: intent.reply,
            context: 'intent',
            messageCount: meta.messageCount,
            lastMessageAt: meta.lastMessageAt,
            greenInstanceDbId: String(greenInstanceDbId || ''),
            phoneDigits: String(parsed.phone || ''),
          },
          'reply',
        );
        if (stopSend.queued) {
          console.log('[Intent] stop-sequence reply queued');
        } else if (stopSend.skipped) {
          console.log('[Intent] stop-sequence reply skipped by pipeline');
        }
      } catch (err) {
        console.error('[Intent] enqueueMessage failed:', err.message);
      }
    }
    await persistStoppedStatus();
    console.log('[Intent] Sequence stopped for', parsed.phone);
    return;
  }
  console.log('[STOP_TRIGGERED] false');

  if (intent.reply && parsed.chatId) {
    try {
      const meta = await getPipelineMetaForPhone(greenInstanceDbId, keyVariants);
      const intentSend = await enqueueMessage(
        {
          instanceId: greenApi.instanceId,
          apiToken: greenApi.apiToken,
          baseUrl: greenApi.baseUrl,
          chatId: parsed.chatId,
          message: intent.reply,
          context: 'intent',
          messageCount: meta.messageCount,
          lastMessageAt: meta.lastMessageAt,
          greenInstanceDbId: String(greenInstanceDbId || ''),
          phoneDigits: String(parsed.phone || ''),
        },
        'reply',
      );
      if (intentSend.queued) {
        console.log('[Intent] Custom reply queued');
        intentReplySent = true;
        console.log('Intent reply queued, blocking sequence');
      } else if (intentSend.skipped) {
        console.log('[Intent] Custom reply skipped by pipeline');
      } else {
        intentReplySent = true;
        console.log('Intent reply sent, blocking sequence');
        console.log('[Intent] Custom reply sent');
      }
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

  const hadState = hasTest || hasProd;
  const emptySeqTurn = { sent: false, sentTemplateText: null, stepIndex: null };
  let sequenceTurn = emptySeqTurn;

  // 1) Campaign template (sequence) first — advances lastSentIndex in state
  if (!intentReplySent && hadState) {
    try {
      if (hasTest) {
        sequenceTurn = (await onIncomingReplyTest(parsed.phone, replyOpts)) || emptySeqTurn;
        console.log('[REPLY_FLOW] executed test path');
      } else if (hasProd) {
        sequenceTurn = (await onIncomingReply(parsed.phone, replyOpts)) || emptySeqTurn;
        console.log('[REPLY_FLOW] executed prod path');
      }
    } catch (replyFlowErr) {
      logger.warn('[Webhook] onIncomingReply failed (non-fatal):', replyFlowErr?.message || String(replyFlowErr));
    }
  }

  // 2) UNKNOWN-only AI second — delayed after template job so WhatsApp usually shows sequence before Alex
  const shouldUseAiReply = String(intent.type || '').toUpperCase() === 'UNKNOWN';
  if (
    shouldUseAiReply &&
    !intentReplySent &&
    hadState &&
    intent.reply === null &&
    intent.stopSequence === false
  ) {
    try {
      let userStateForAi = null;
      for (const key of keyVariants) {
        userStateForAi = await Promise.resolve(state.getState(greenInstanceDbId, key));
        if (userStateForAi) break;
        userStateForAi = testState.getState(greenInstanceDbId, key);
        if (userStateForAi) break;
      }
      const contactData = await getContactPayloadByPhone(
        greenInstanceDbId,
        norm,
        userStateForAi?.campaignId,
      );
      const aiResult = await generateAiReply({
        incomingText: parsed.text,
        intentType: intent.type,
        userState: userStateForAi,
        phoneDigits: norm,
        greenInstanceDbId,
        contactData,
        recentInbound: userStateForAi?.recentInbound || [],
        lastSequenceMessageSent: sequenceTurn.sent ? sequenceTurn.sentTemplateText : undefined,
      });

      if (aiResult.replyText && parsed.chatId) {
        const meta = await getPipelineMetaForPhone(greenInstanceDbId, keyVariants);
        const delayParsed = parseInt(String(process.env.AI_AFTER_SEQUENCE_DELAY_MS || '12000'), 10);
        const delayMs =
          sequenceTurn.sent === true
            ? Math.max(0, Number.isFinite(delayParsed) ? delayParsed : 12000)
            : 0;
        const aiSend = await enqueueMessage(
          {
            instanceId: greenApi.instanceId,
            apiToken: greenApi.apiToken,
            baseUrl: greenApi.baseUrl,
            chatId: parsed.chatId,
            message: aiResult.replyText,
            context: 'intent',
            messageCount: meta.messageCount,
            lastMessageAt: meta.lastMessageAt,
            greenInstanceDbId: String(greenInstanceDbId || ''),
            phoneDigits: String(parsed.phone || ''),
          },
          'reply',
          delayMs > 0 ? { delayMs } : {},
        );
        if (aiSend.queued === true) {
          console.log(
            '[AI Reply] queued for',
            parsed.phone,
            '| delayMs:',
            delayMs,
            '| text:',
            aiResult.replyText.slice(0, 50),
          );
        }
      }

      if (aiResult.blockSequence) {
        console.log('[AI Reply] blockSequence=true for', parsed.phone);
        await persistStoppedStatus();
        return;
      }
    } catch (aiErr) {
      console.error('[AI Reply] block failed (sequence continues):', aiErr.message);
    }
  }

  console.log('[REPLYFLOW_CHECK]', {
    hasTest,
    hasProd,
    phone: parsed.phone,
    keyVariants,
    instanceId: greenInstanceDbId,
    sequenceSentThisTurn: sequenceTurn.sent,
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
  if (!hadState) {
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
