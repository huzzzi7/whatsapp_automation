/**
 * Reply-driven flow: send only message 1 on campaign start; send next message on each reply.
 * Production uses state.js; test automation uses testState.js — shared cores: sendFirstMessageOnlyWithStore, runIncomingReply.
 */
const { normalizePhone, toChatId } = require('./phone');
const { buildSequence } = require('./messages');
const { enqueueMessage } = require('./queues/enqueueMessage');
const state = require('./state');
const testState = require('./testState');
const appConfig = require('../config');
const { createLogger, logger } = require('./utils/logger');
const { updateOutboundMeta } = require('./repositories/conversationStateRepository');

const inFlightMap = new Map();
const logWebhook = createLogger('webhook');

function buildInFlightKey(instanceId, phone, index) {
  return `${instanceId}:${phone}:${index}`;
}

function acquireInFlightLock(key) {
  if (inFlightMap.has(key)) return false;
  inFlightMap.set(key, Date.now());
  return true;
}

function releaseInFlightLock(key) {
  inFlightMap.delete(key);
}

function pickRandomMessage(message) {
  if (Array.isArray(message) && message.length > 0) {
    const index = Math.floor(Math.random() * message.length);
    return message[index];
  }
  return message;
}

function getMessageCooldownMs() {
  const raw = parseInt(process.env.MESSAGE_COOLDOWN_MS || '120000', 10);
  if (!Number.isFinite(raw) || raw < 0) return 120000;
  return raw;
}

function getReplyContextCooldownMs() {
  const raw = parseInt(process.env.REPLY_COOLDOWN_MS || '120000', 10);
  if (!Number.isFinite(raw) || raw < 0) return 120000;
  return raw;
}

const DEFAULT_SEND_FIRST_MESSAGE_CONCURRENCY = 1;

/**
 * First-message batch concurrency from SEND_FIRST_MESSAGE_CONCURRENCY (integer ≥ 1).
 * Unset or invalid → 1 (sequential, Phase 1.1 fix).
 */
function getSendFirstMessageConcurrency() {
  const raw = process.env.SEND_FIRST_MESSAGE_CONCURRENCY;
  if (raw == null || String(raw).trim() === '') {
    return DEFAULT_SEND_FIRST_MESSAGE_CONCURRENCY;
  }
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_SEND_FIRST_MESSAGE_CONCURRENCY;
  }
  return n;
}

/** Parallel map with bounded concurrency (Green API safety). */
async function runWithConcurrency(items, limit, fn) {
  const n = items.length;
  if (n === 0) return;
  const cap = Math.max(1, Math.min(limit, n));
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= n) break;
      await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
}

/**
 * @param {string} chatId
 * @param {string} message
 * @param {{ instanceId: string, apiToken: string, baseUrl: string }} greenApi
 * @param {{ store?: StateStore, greenInstanceDbId?: string, phone?: string, pipelineContext?: string, messageCount?: number, lastMessageAt?: number, firstMessage?: boolean }} [context]
 */
async function safeSend(chatId, message, greenApi, context = {}) {
  try {
    const { store, greenInstanceDbId, phone } = context || {};
    const cid =
      context.campaignId != null && String(context.campaignId).trim() !== ''
        ? String(context.campaignId).trim()
        : undefined;
    const trace = createLogger('server', {
      campaignId: cid,
      chatId,
      phoneDigits: phone ? String(phone).replace(/\D/g, '') : undefined,
    });
    // Cooldown (MESSAGE_COOLDOWN_MS) applies only to campaign sends — reply/intent/sequence are not blocked
    // by lastOutboundAt so users get immediate follow-ups when they reply quickly.
    const pipelineContext = context.pipelineContext || 'reply';
    if (store && greenInstanceDbId && phone) {
      const possibleKeys = [String(phone || '').replace(/\D/g, ''), String(phone || '').replace(/\D/g, '').replace(/^0+/, '')];
      const uniqueKeys = [...new Set(possibleKeys.filter((k) => k && k.length > 0))];
      let currentState = null;
      for (const key of uniqueKeys) {
        currentState = await Promise.resolve(store.getState(greenInstanceDbId, key));
        if (currentState) break;
      }
      const lastOutboundAt = Number(currentState?.lastOutboundAt);
      if (pipelineContext === 'campaign' && !context.firstMessage && Number.isFinite(lastOutboundAt)) {
        const cooldownMs = getMessageCooldownMs();
        const timeSinceLast = Date.now() - lastOutboundAt;
        if (timeSinceLast < cooldownMs) {
          trace.info(
            {
              event: 'send_cooldown_active',
              pipelineContext,
              timeSinceLast,
              cooldownMs,
              phoneDigits: phone,
            },
            'send blocked by cooldown',
          );
          return { ok: false, skipped: 'cooldown' };
        }
      }
    }
    trace.debug({ event: 'send_cooldown_passed', pipelineContext }, 'send_cooldown_passed');
    const finalMessage = pickRandomMessage(message);
    trace.debug({ event: 'send_message_selected', pipelineContext }, 'send_message_selected');
    const messageCount = context.messageCount != null ? context.messageCount : 0;
    const lastMessageAt = context.lastMessageAt;
    const result = await enqueueMessage(
      {
        instanceId: greenApi.instanceId,
        apiToken: greenApi.apiToken,
        baseUrl: greenApi.baseUrl,
        chatId,
        message: finalMessage,
        context: pipelineContext,
        messageCount,
        lastMessageAt,
        greenInstanceDbId: context.greenInstanceDbId || '',
        phoneDigits: context.phone || '',
        campaignId: cid || '',
      },
      'message',
    );
    if (result.queued) {
      trace.debug({ event: 'message_enqueued', pipelineContext }, 'message_enqueued');
      return { ok: true, queued: true };
    }
    if (result.skipped) {
      trace.debug({ event: 'message_skipped_enqueue', pipelineContext }, 'message_skipped_enqueue');
      return { ok: false, skipped: 'pipeline' };
    }
    trace.debug({ event: 'message_sent_direct', pipelineContext, delayMs: result.delay }, 'message_sent_direct');
    return { ok: true };
  } catch (err) {
    const msg = err?.message || 'Send failed';
    createLogger('server', { chatId }).error({ err: msg, event: 'safe_send_failed' }, 'Failed sending');
    return { ok: false, error: msg };
  }
}

/**
 * @typedef {{ getState: Function, setState: Function, updateLastSent: Function, tryAdvanceLastSent?: Function, deleteState: Function }} StateStore
 */

/**
 * Send message 1 to each user and persist progress (reply-driven continuation uses same store).
 * @param {Array} users
 * @param {Object} config - { messageTemplates }
 * @param {{ greenApi: object, greenInstanceDbId: string, stableCampaignId?: string, pauseCheck?: () => Promise<boolean> }} opts
 *   pauseCheck: if returns true, stop sending remaining users in this batch (partial send).
 * @param {StateStore} store
 * @param {string} campaignIdPrefix - e.g. "campaign-" or "test-" (ignored if opts.stableCampaignId is set)
 * @param {{ shouldSkipUser?: (user: object, phone: string) => boolean | Promise<boolean> }} [hooks]
 * @returns {Promise<{ startedUsers: number, sentPhoneDigits: string[], failedSends: Record<string, string> }>}
 */
async function sendFirstMessageOnlyWithStore(users, config, opts, store, campaignIdPrefix, hooks = {}) {
  const { messageTemplates } = config;
  const { greenApi, greenInstanceDbId, stableCampaignId, pauseCheck } = opts || {};
  const { shouldSkipUser } = hooks;

  if (!greenApi || !greenInstanceDbId) {
    throw new Error('sendFirstMessageOnlyWithStore requires greenApi and greenInstanceDbId');
  }

  const stable = stableCampaignId != null && String(stableCampaignId).trim() !== '' ? String(stableCampaignId).trim() : '';
  const campaignId = stable || `${String(campaignIdPrefix || '')}${Date.now()}`;
  let startedUsers = 0;
  const sentPhoneDigits = [];
  /** @type {Record<string, string>} normalized phone -> last Green API error message */
  const failedSends = {};

  const list = Array.isArray(users) ? users : [];
  const SEND_FIRST_MESSAGE_CONCURRENCY = getSendFirstMessageConcurrency();
  const campLog = createLogger('server', { campaignId });
  campLog.debug({ event: 'campaign_first_message_concurrency', concurrency: SEND_FIRST_MESSAGE_CONCURRENCY }, 'first_message_concurrency');
  let batchPaused = false;

  await runWithConcurrency(list, SEND_FIRST_MESSAGE_CONCURRENCY, async (user) => {
    if (batchPaused) return;
    if (typeof pauseCheck === 'function') {
      const shouldPause = await pauseCheck();
      if (shouldPause) {
        batchPaused = true;
        campLog.info({ event: 'campaign_pause_mid_batch' }, 'pauseCheck: stopping mid-batch');
        return;
      }
    }

    const phoneDigits = normalizePhone((user.phone || '').trim(), appConfig.defaultCountryCode);
    if (!phoneDigits) return;

    if (typeof shouldSkipUser === 'function') {
      const skip = await shouldSkipUser(user, phoneDigits);
      if (skip) return;
    }

    const sequence = user.sequence || buildSequence(user, messageTemplates);
    if (!sequence || sequence.length < 1) {
      campLog.warn({ event: 'campaign_invalid_sequence', phoneDigits }, 'Invalid message sequence');
      return;
    }

    const chatId = toChatId(phoneDigits);
    if (!chatId) return;

    const text = sequence[0];
    if (text == null || String(text).trim() === '') return;

    campLog.debug({ event: 'campaign_dispatch_message_1', phoneDigits, chatId }, 'Sending message 1');
    const priorState = await Promise.resolve(store.getState(greenInstanceDbId, phoneDigits));
    const sendResult = await safeSend(chatId, text, greenApi, {
      store,
      greenInstanceDbId,
      phone: phoneDigits,
      pipelineContext: 'campaign',
      firstMessage: true,
      messageCount: 0,
      lastMessageAt: priorState?.lastOutboundAt,
      campaignId,
    });
    if (sendResult.ok) {
      store.setState(greenInstanceDbId, phoneDigits, {
        lastSentIndex: 1,
        sequence,
        campaignId,
        lastOutboundAt: Date.now(),
        status: 'active',
      });
      try {
        await updateOutboundMeta(greenInstanceDbId, phoneDigits, { lastOutboundAt: Date.now() });
      } catch (err) {
        logger.warn('[ReplyFlow] updateOutboundMeta failed (non-fatal):', err.message);
      }
      startedUsers += 1;
      sentPhoneDigits.push(phoneDigits);
    } else if (sendResult.error) {
      failedSends[phoneDigits] = sendResult.error;
    }
  });

  campLog.info({ event: 'campaign_first_messages_dispatched', startedUsers }, 'Conversations started (message 1)');
  return { startedUsers, sentPhoneDigits, failedSends };
}

/**
 * Send only message 1 to each user (production state). Same behavior as before refactor.
 * @param {Array} users
 * @param {Object} config - { messageTemplates }
 * @param {{ greenApi: object, greenInstanceDbId: string }} opts
 */
async function sendFirstMessageOnly(users, config, opts) {
  const { greenInstanceDbId } = opts || {};
  return sendFirstMessageOnlyWithStore(users, config, opts, state, 'campaign-', {
    async shouldSkipUser(user, phoneDigits) {
      const existing = await Promise.resolve(state.getState(greenInstanceDbId, phoneDigits));
      if (existing != null && existing.lastSentIndex >= 1) {
        const cid = String(existing.campaignId || '');
        if (!cid.startsWith('test-')) {
          createLogger('server', { phoneDigits }).debug(
            { event: 'campaign_skip_already_started' },
            'Skipping conversation already started',
          );
          return true;
        }
      }
      return false;
    },
  });
}

/**
 * @param {string} phone
 * @param {{ greenApi: object, greenInstanceDbId: string, incomingText?: string, lastIntentType?: string }} opts
 * @param {StateStore} store
 * @param {string} logPrefix - e.g. "ReplyFlow-Prod"
 */
async function runIncomingReply(phone, opts, store, logPrefix) {
  const { greenApi, greenInstanceDbId, incomingText, lastIntentType } = opts || {};
  const flow = logWebhook.child({ logPrefix });
  if (!greenApi || !greenInstanceDbId) {
    flow.error({ event: 'reply_flow_missing_config' }, 'Missing greenApi or greenInstanceDbId');
    return;
  }

  flow.debug({ event: 'incoming_reply_phone', phone, greenInstanceDbId }, 'Incoming reply');

  let normalized = String(phone || '').replace(/\D/g, '');
  if (!normalized) return;

  const possibleKeys = [normalized, normalized.replace(/^0+/, '')];
  const uniqueKeys = [...new Set(possibleKeys.filter((k) => k && k.length > 0))];

  let userState = null;
  for (const key of uniqueKeys) {
    userState = await Promise.resolve(store.getState(greenInstanceDbId, key));
    if (userState) {
      normalized = key;
      break;
    }
  }

  if (userState == null) {
    flow.debug({ event: 'unknown_phone_ignored', phone }, 'Unknown phone ignored');
    return;
  }

  const trace = flow.child({
    campaignId: userState.campaignId != null ? String(userState.campaignId) : undefined,
    phoneDigits: normalized,
    chatId: toChatId(normalized) || undefined,
  });

  const statusNorm = String(userState.status || '').toLowerCase();
  trace.debug({ event: 'state_status', status: statusNorm || 'active' }, 'state_status');

  if (statusNorm === 'stopped') {
    const ltRaw = lastIntentType != null && String(lastIntentType).trim() !== '' ? String(lastIntentType).trim() : '';
    const intentUpper = ltRaw ? ltRaw.toUpperCase() : '';
    const inboundLower = String(incomingText || '').toLowerCase();
    const restartPhrases = /\b(restart|continue|start)\b/i.test(inboundLower);
    const allowResume = restartPhrases;

    if (allowResume) {
      const cleared = { ...userState, status: 'active' };
      store.setState(greenInstanceDbId, normalized, cleared);
      userState = cleared;
      trace.info({ event: 'user_resumed_active' }, 'Resumed active after restart phrase or non-opt-out intent');
    } else {
      trace.info(
        { event: 'reply_blocked_user_stopped', status: statusNorm, inboundText: incomingText },
        'reply blocked: user stopped, no restart phrase',
      );
      trace.debug({ event: 'skipped_user_stopped_opt_out' }, 'skipped user_stopped_opt_out');
      return;
    }
  }

  trace.debug({ event: 'state_found', lastSentIndex: userState.lastSentIndex }, 'State found');
  const sequence = userState.sequence;
  if (!sequence || sequence.length < 1) {
    trace.info(
      { event: 'reply_blocked_empty_sequence', lastSentIndex: userState.lastSentIndex },
      'reply blocked: sequence empty or missing in state',
    );
    store.deleteState(greenInstanceDbId, normalized);
    return;
  }

  if (userState.lastSentIndex >= sequence.length) {
    store.deleteState(greenInstanceDbId, normalized);
    return;
  }

  const nextIndex = userState.lastSentIndex;
  if (nextIndex >= sequence.length) {
    trace.error({ event: 'invalid_conversation_state', normalized }, 'Invalid conversation state');
    store.deleteState(greenInstanceDbId, normalized);
    return;
  }

  const text = sequence[nextIndex];
  if (text == null || String(text).trim() === '') {
    const newIndex = nextIndex + 1;
    if (typeof store.tryAdvanceLastSent === 'function') {
      const advance = await Promise.resolve(
        store.tryAdvanceLastSent(greenInstanceDbId, normalized, nextIndex, newIndex),
      );
      if (!advance.success) {
        trace.debug({ event: 'lock_race_empty_message_branch' }, 'Skipped duplicate execution (race)');
        return;
      }
      trace.debug({ event: 'lock_acquired_empty_message_branch', normalized }, 'Lock acquired');
      if (newIndex >= sequence.length) {
        store.deleteState(greenInstanceDbId, normalized);
        trace.info({ event: 'conversation_completed' }, 'Conversation completed');
      }
    } else {
      if (newIndex >= sequence.length) {
        store.deleteState(greenInstanceDbId, normalized);
        trace.info({ event: 'conversation_completed' }, 'Conversation completed');
      } else {
        store.updateLastSent(greenInstanceDbId, normalized, newIndex);
      }
    }
    return;
  }

  const chatId = toChatId(normalized);
  if (!chatId) return;

  const currentIndex = userState.lastSentIndex;
  const lockKey = buildInFlightKey(greenInstanceDbId, normalized, currentIndex);
  const lockAcquired = acquireInFlightLock(lockKey);
  if (lockAcquired === false) {
    trace.debug({ event: 'lock_blocked_duplicate', lockKey }, 'Duplicate send blocked');
    return;
  }
  trace.debug({ event: 'lock_acquired', lockKey }, 'Lock acquired');
  // MOVED POST-SEND to prevent sequence skip bug

  try {
    trace.debug(
      { event: 'template_send_start', sequenceIndex: currentIndex, seqLen: sequence.length },
      'Sending sequence message',
    );
    const sendResult = await safeSend(chatId, text, greenApi, {
      store,
      greenInstanceDbId,
      phone: normalized,
      pipelineContext: 'reply',
      messageCount: currentIndex,
      lastMessageAt: userState.lastOutboundAt,
      campaignId: userState.campaignId != null ? String(userState.campaignId) : undefined,
    });

    if (sendResult?.ok !== true) {
      if (sendResult?.skipped === 'cooldown' || sendResult?.skipped === 'pipeline') {
        trace.debug({ event: 'send_skipped_index_unchanged', reason: sendResult?.skipped }, 'Send skipped');
      } else {
        trace.debug({ event: 'send_failed_index_unchanged' }, 'Index not advanced due to failed send');
      }
      return;
    }

    trace.debug({ event: 'send_success_advancing' }, 'Send success, advancing index');
    const newIndex = currentIndex + 1;
    if (typeof store.tryAdvanceLastSent === 'function') {
      const advancePostSend = await Promise.resolve(
        store.tryAdvanceLastSent(greenInstanceDbId, normalized, currentIndex, newIndex),
      );
      if (!advancePostSend.success) {
        trace.debug({ event: 'lock_race_post_send' }, 'Skipped duplicate execution post-send');
        return;
      }
      trace.debug({ event: 'lock_acquired_post_send', normalized }, 'Lock acquired post-send');
      if (newIndex >= sequence.length) {
        store.deleteState(greenInstanceDbId, normalized);
        trace.info({ event: 'conversation_completed' }, 'Conversation completed');
      } else {
        store.setState(greenInstanceDbId, normalized, {
          ...userState,
          lastSentIndex: newIndex,
          lastOutboundAt: Date.now(),
        });
        try {
          await updateOutboundMeta(greenInstanceDbId, normalized, { lastOutboundAt: Date.now() });
        } catch (err) {
          logger.warn('[ReplyFlow] updateOutboundMeta failed (non-fatal):', err.message);
        }
      }
    } else if (newIndex >= sequence.length) {
      store.deleteState(greenInstanceDbId, normalized);
      trace.info({ event: 'conversation_completed' }, 'Conversation completed');
    } else {
      store.updateLastSent(greenInstanceDbId, normalized, newIndex);
      store.setState(greenInstanceDbId, normalized, {
        ...userState,
        lastSentIndex: newIndex,
        lastOutboundAt: Date.now(),
      });
      try {
        await updateOutboundMeta(greenInstanceDbId, normalized, { lastOutboundAt: Date.now() });
      } catch (err) {
        logger.warn('[ReplyFlow] updateOutboundMeta failed (non-fatal):', err.message);
      }
    }
  } finally {
    releaseInFlightLock(lockKey);
    trace.debug({ event: 'lock_released', lockKey }, 'Lock released');
  }
}

/**
 * @param {string} phone - Normalized phone (digits)
 * @param {{ greenApi: object, greenInstanceDbId: string, incomingText?: string, lastIntentType?: string }} opts
 */
async function onIncomingReply(phone, opts) {
  return runIncomingReply(phone, opts, state, 'ReplyFlow-Prod');
}

/**
 * @param {string} phone
 * @param {{ greenApi: object, greenInstanceDbId: string, incomingText?: string, lastIntentType?: string }} opts
 */
async function onIncomingReplyTest(phone, opts) {
  return runIncomingReply(phone, opts, testState, 'ReplyFlow-Test');
}

module.exports = {
  sendFirstMessageOnly,
  sendFirstMessageOnlyWithStore,
  onIncomingReply,
  onIncomingReplyTest,
};
