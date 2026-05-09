/**
 * Phase 5 — Processes one warmup pair conversation end-to-end.
 */
const pool = require('../mysql');
const { toChatId } = require('../phone');
const { resolveGreenApiConfig } = require('../greenInstance');
const { controlledSend } = require('./controlledSend');
const { waitForRateLimit } = require('../utils/instanceRateLimiter');
const warmupRepository = require('../repositories/warmupRepository');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

function safeParseMessagesJson(messagesJson) {
  try {
    const arr = typeof messagesJson === 'string' ? JSON.parse(messagesJson) : messagesJson;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function loadGreenInstanceRow(instanceDbId) {
  const [rows] = await pool.execute(
    'SELECT * FROM green_instances WHERE id = ? AND isActive = 1 AND manualDisabled = 0 LIMIT 1',
    [instanceDbId],
  );
  return rows[0] || null;
}

async function runWarmupPair(pair) {
  const pairId = pair?.id;
  const sessionId = pair?.sessionId;
  if (!pairId || !sessionId) {
    throw new Error('runWarmupPair requires pair.id and pair.sessionId');
  }

  const pairLog = log.child({ pairId, sessionId });
  await warmupRepository.updatePairStatus(pairId, 'running');

  const session = await warmupRepository.getSessionById(sessionId);
  if (!session) {
    throw new Error(`Warmup session not found: ${sessionId}`);
  }
  if (session.status !== 'running') {
    pairLog.info({ event: 'warmup_pair_session_not_running', status: session.status }, 'Session not running; exiting pair');
    return;
  }

  const template = await warmupRepository.getTemplateById(pair.templateId);
  if (!template) {
    throw new Error(`Warmup template not found: ${pair.templateId}`);
  }

  const messages = safeParseMessagesJson(template.messagesJson);
  if (messages.length < 2) {
    throw new Error(`Warmup template messages_json invalid/empty for templateId=${template.id}`);
  }

  const aRow = await loadGreenInstanceRow(pair.senderInstanceDbId);
  const bRow = await loadGreenInstanceRow(pair.receiverInstanceDbId);
  if (!aRow || !bRow) {
    throw new Error(
      `Green instance not found or not authorized/enabled: sender=${pair.senderInstanceDbId}, receiver=${pair.receiverInstanceDbId}`,
    );
  }

  const aGreen = resolveGreenApiConfig(aRow);
  const bGreen = resolveGreenApiConfig(bRow);

  const aPhone = String(aRow.phoneNumber || '').replace(/\D/g, '');
  const bPhone = String(bRow.phoneNumber || '').replace(/\D/g, '');

  if (!aPhone || !bPhone) {
    log.warn(
      {
        event: 'warmup_pair_missing_phone',
        pairId: pair.id,
        senderInstanceId: pair.senderInstanceDbId,
        receiverInstanceId: pair.receiverInstanceDbId,
        aPhone: aPhone || 'MISSING',
        bPhone: bPhone || 'MISSING',
      },
      'Warmup pair has missing phone number — pair will fail. Ensure getWaSettings succeeded at session start.',
    );
    throw new Error(
      `Warmup pair ${pair.id} requires phoneNumber for both instances. ` +
        `Sender: ${aPhone || 'MISSING'}, Receiver: ${bPhone || 'MISSING'}`,
    );
  }

  const aChatId = toChatId(aPhone);
  const bChatId = toChatId(bPhone);

  const messagesTarget = Math.max(1, Math.floor(Number(pair.messagesTarget) || 10));
  const maxIdx = Math.min(messagesTarget, messages.length);

  pairLog.info(
    {
      event: 'warmup_pair_start',
      templateId: template.id,
      templateIndex: template.templateIndex,
      messagesTarget,
      templateMessages: messages.length,
    },
    'warmup_pair_start',
  );

  for (let i = 0; i < maxIdx; i += 1) {
    const sessionNow = await warmupRepository.getSessionById(sessionId);
    if (!sessionNow || sessionNow.status !== 'running') {
      pairLog.info({ event: 'warmup_pair_session_stopped', status: sessionNow?.status || null }, 'Session stopped; exiting');
      return;
    }

    const pairNow = (await warmupRepository.getPairsBySession(sessionId)).find((p) => p.id === pairId) || null;
    if (pairNow && (pairNow.status === 'failed' || pairNow.status === 'completed')) return;

    const step = messages[i] || {};
    const role = String(step.role || 'A').toUpperCase() === 'B' ? 'B' : 'A';
    const text = String(step.text || '').trim();
    if (!text) continue;

    const senderGreen = role === 'A' ? aGreen : bGreen;
    const receiverChatId = role === 'A' ? bChatId : aChatId;
    const senderInstanceDbId = role === 'A' ? pair.senderInstanceDbId : pair.receiverInstanceDbId;
    const receiverInstanceDbId = role === 'A' ? pair.receiverInstanceDbId : pair.senderInstanceDbId;

    const warmupMessageId = await warmupRepository.insertWarmupMessage({
      pairId,
      sessionId,
      senderInstanceDbId,
      receiverInstanceDbId,
      role,
      messageText: text,
      messageIndex: i,
    });

    let sendResult;
    try {
      await waitForRateLimit(senderGreen.instanceId);
      sendResult = await controlledSend({
        instanceId: senderGreen.instanceId,
        apiToken: senderGreen.apiToken,
        baseUrl: senderGreen.baseUrl,
        chatId: receiverChatId,
        message: text,
        context: 'warmup',
        messageCount: i,
        lastMessageAt: undefined,
        campaignId: `warmup-${sessionId}`,
        phoneDigits: role === 'A' ? aPhone : bPhone,
      });
    } catch (err) {
      pairLog.error(
        { event: 'warmup_pair_message_failed', warmupMessageId, i, err: err.message },
        'Warmup message failed',
      );
      await warmupRepository.updateMessageStatus(warmupMessageId, 'failed', { errorMessage: err.message });
      await warmupRepository.updatePairStatus(pairId, 'failed', { errorMessage: err.message });
      return;
    }

    if (sendResult && sendResult.skipped) {
      // Should not happen after controlledSend warmup override, but handle as retry.
      pairLog.warn(
        { event: 'warmup_message_skipped_retry', i },
        'Warmup message skipped, will retry same index',
      );
      await warmupRepository.updateMessageStatus(warmupMessageId, 'failed', { errorMessage: 'skipped_retrying' });
      i -= 1; // retry same message index next iteration
    } else {
      await warmupRepository.updateMessageStatus(warmupMessageId, 'sent');
      await warmupRepository.incrementPairMessagesSent(pairId);
      pairLog.info(
        { event: 'warmup_message_sent', warmupMessageId, role, i, delayMs: sendResult?.delay },
        'warmup_message_sent',
      );
    }
  }

  await warmupRepository.updatePairStatus(pairId, 'completed');
  pairLog.info({ event: 'warmup_pair_completed' }, 'warmup_pair_completed');
}

module.exports = { runWarmupPair };

