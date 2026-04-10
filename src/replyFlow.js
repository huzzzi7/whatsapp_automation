/**
 * Reply-driven flow: send only message 1 on campaign start; send next message on each reply.
 * Production uses state.js; test automation uses testState.js — shared cores: sendFirstMessageOnlyWithStore, runIncomingReply.
 */
const { normalizePhone, toChatId } = require('./phone');
const { buildSequence } = require('./messages');
const { sendMessage } = require('./greenapi');
const state = require('./state');
const testState = require('./testState');
const appConfig = require('../config');

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 */
async function safeSend(chatId, message, greenApi) {
  try {
    await sendMessage(chatId, message, greenApi);
    console.log('[GreenAPI] Message sent to', chatId);
    return { ok: true };
  } catch (err) {
    const msg = err?.message || 'Send failed';
    console.error('[GreenAPI] Failed sending to', chatId, msg);
    return { ok: false, error: msg };
  }
}

/**
 * @typedef {{ getState: Function, setState: Function, updateLastSent: Function, deleteState: Function }} StateStore
 */

/**
 * Send message 1 to each user and persist progress (reply-driven continuation uses same store).
 * @param {Array} users
 * @param {Object} config - { messageTemplates }
 * @param {{ greenApi: object, greenInstanceDbId: string, messageDelayMs?: number, stableCampaignId?: string, pauseCheck?: () => Promise<boolean> }} opts
 *   pauseCheck: if returns true, stop sending remaining users in this batch (partial send).
 * @param {StateStore} store
 * @param {string} campaignIdPrefix - e.g. "campaign-" or "test-" (ignored if opts.stableCampaignId is set)
 * @param {{ shouldSkipUser?: (user: object, phone: string) => boolean | Promise<boolean> }} [hooks]
 * @returns {Promise<{ startedUsers: number, sentPhoneDigits: string[], failedSends: Record<string, string> }>}
 */
async function sendFirstMessageOnlyWithStore(users, config, opts, store, campaignIdPrefix, hooks = {}) {
  const { messageTemplates } = config;
  const { greenApi, greenInstanceDbId, messageDelayMs = 0, stableCampaignId, pauseCheck } = opts || {};
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
  const delay = Math.max(0, Number(messageDelayMs) || 0);
  const SEND_FIRST_MESSAGE_CONCURRENCY = 8;
  let batchPaused = false;

  await runWithConcurrency(list, SEND_FIRST_MESSAGE_CONCURRENCY, async (user) => {
    if (batchPaused) return;
    if (typeof pauseCheck === 'function') {
      const shouldPause = await pauseCheck();
      if (shouldPause) {
        batchPaused = true;
        console.log('[Campaign] pauseCheck: stopping mid-batch');
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
      console.warn('[Campaign] Invalid message sequence for', phoneDigits);
      return;
    }

    const chatId = toChatId(phoneDigits);
    if (!chatId) return;

    const text = sequence[0];
    if (text == null || String(text).trim() === '') return;

    console.log('[Campaign] Sending message 1 to', phoneDigits);
    const sendResult = await safeSend(chatId, text, greenApi);
    if (sendResult.ok) {
      store.setState(greenInstanceDbId, phoneDigits, {
        lastSentIndex: 1,
        sequence,
        campaignId,
      });
      startedUsers += 1;
      sentPhoneDigits.push(phoneDigits);
    } else if (sendResult.error) {
      failedSends[phoneDigits] = sendResult.error;
    }

    if (delay > 0) {
      await sleep(delay);
    }
  });

  console.log('[Campaign] Conversations started:', startedUsers);
  return { startedUsers, sentPhoneDigits, failedSends };
}

/**
 * Send only message 1 to each user (production state). Same behavior as before refactor.
 * @param {Array} users
 * @param {Object} config - { messageTemplates }
 * @param {{ greenApi: object, greenInstanceDbId: string, messageDelayMs?: number }} opts
 */
async function sendFirstMessageOnly(users, config, opts) {
  const { greenInstanceDbId } = opts || {};
  return sendFirstMessageOnlyWithStore(users, config, opts, state, 'campaign-', {
    async shouldSkipUser(user, phoneDigits) {
      const existing = await Promise.resolve(state.getState(greenInstanceDbId, phoneDigits));
      if (existing != null && existing.lastSentIndex >= 1) {
        const cid = String(existing.campaignId || '');
        if (!cid.startsWith('test-')) {
          console.log('[Campaign] Skipping', phoneDigits, 'conversation already started');
          return true;
        }
      }
      return false;
    },
  });
}

/**
 * @param {string} phone
 * @param {{ greenApi: object, greenInstanceDbId: string }} opts
 * @param {StateStore} store
 * @param {string} logPrefix - e.g. "ReplyFlow-Prod"
 */
async function runIncomingReply(phone, opts, store, logPrefix) {
  const { greenApi, greenInstanceDbId } = opts || {};
  if (!greenApi || !greenInstanceDbId) {
    console.error(`[${logPrefix}] Missing greenApi or greenInstanceDbId`);
    return;
  }

  console.log(`[${logPrefix}] Incoming phone:`, phone);
  console.log(`[${logPrefix}] Instance:`, greenInstanceDbId);

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
    console.log(`[${logPrefix}] Unknown phone ignored:`, phone);
    return;
  }
  console.log(`[${logPrefix}] State found, lastSentIndex:`, userState.lastSentIndex);
  const sequence = userState.sequence;
  if (!sequence || sequence.length < 1) {
    store.deleteState(greenInstanceDbId, normalized);
    return;
  }

  if (userState.lastSentIndex >= sequence.length) {
    store.deleteState(greenInstanceDbId, normalized);
    return;
  }

  const nextIndex = userState.lastSentIndex;
  if (nextIndex >= sequence.length) {
    console.error(`[${logPrefix}] Invalid conversation state for`, normalized);
    store.deleteState(greenInstanceDbId, normalized);
    return;
  }

  const text = sequence[nextIndex];
  if (text == null || String(text).trim() === '') {
    const newIndex = nextIndex + 1;
    if (newIndex >= sequence.length) {
      store.deleteState(greenInstanceDbId, normalized);
      console.log(`[${logPrefix}] Conversation completed for`, normalized);
    } else {
      store.updateLastSent(greenInstanceDbId, normalized, newIndex);
    }
    return;
  }

  const chatId = toChatId(normalized);
  if (!chatId) return;

  console.log(`[${logPrefix}] Sending message`, nextIndex + 1, '/', sequence.length, 'to', normalized);
  const sendResult = await safeSend(chatId, text, greenApi);
  if (sendResult.ok) {
    const newIndex = nextIndex + 1;
    if (newIndex >= sequence.length) {
      store.deleteState(greenInstanceDbId, normalized);
      console.log(`[${logPrefix}] Conversation completed for`, normalized);
    } else {
      store.updateLastSent(greenInstanceDbId, normalized, newIndex);
    }
  }
}

/**
 * @param {string} phone - Normalized phone (digits)
 * @param {{ greenApi: object, greenInstanceDbId: string }} opts
 */
async function onIncomingReply(phone, opts) {
  return runIncomingReply(phone, opts, state, 'ReplyFlow-Prod');
}

/**
 * @param {string} phone
 * @param {{ greenApi: object, greenInstanceDbId: string }} opts
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
