/**
 * Reply-driven flow: send only message 1 on campaign start; send next message on each reply.
 * Production uses state.js; test automation uses testState.js — shared cores: sendFirstMessageOnlyWithStore, runIncomingReply.
 */
const { toChatId } = require('./phone');
const { buildSequence } = require('./messages');
const { sendMessage } = require('./greenapi');
const state = require('./state');
const testState = require('./testState');

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return true;
  } catch (err) {
    console.error('[GreenAPI] Failed sending to', chatId, err.message);
    return false;
  }
}

/**
 * @typedef {{ getState: Function, setState: Function, updateLastSent: Function, deleteState: Function }} StateStore
 */

/**
 * Send message 1 to each user and persist progress (reply-driven continuation uses same store).
 * @param {Array} users
 * @param {Object} config - { messageTemplates }
 * @param {{ greenApi: object, greenInstanceDbId: string, messageDelayMs?: number }} opts
 * @param {StateStore} store
 * @param {string} campaignIdPrefix - e.g. "campaign-" or "test-"
 * @param {{ shouldSkipUser?: (user: object, phone: string) => boolean }} [hooks]
 * @returns {Promise<{ startedUsers: number }>}
 */
async function sendFirstMessageOnlyWithStore(users, config, opts, store, campaignIdPrefix, hooks = {}) {
  const { messageTemplates } = config;
  const { greenApi, greenInstanceDbId, messageDelayMs = 0 } = opts || {};
  const { shouldSkipUser } = hooks;

  if (!greenApi || !greenInstanceDbId) {
    throw new Error('sendFirstMessageOnlyWithStore requires greenApi and greenInstanceDbId');
  }

  const campaignId = String(campaignIdPrefix || '') + Date.now();
  let startedUsers = 0;

  const list = Array.isArray(users) ? users : [];
  const delay = Math.max(0, Number(messageDelayMs) || 0);
  for (let idx = 0; idx < list.length; idx += 1) {
    try {
      const user = list[idx];
      const phone = (user.phone || '').trim();
      if (!phone) continue;

      if (typeof shouldSkipUser === 'function' && shouldSkipUser(user, phone)) {
        continue;
      }

      const sequence = user.sequence || buildSequence(user, messageTemplates);
      if (!sequence || sequence.length < 1) {
        console.warn('[Campaign] Invalid message sequence for', phone);
        continue;
      }

      const chatId = toChatId(phone);
      if (!chatId) continue;

      const text = sequence[0];
      if (text == null || String(text).trim() === '') continue;

      console.log('[Campaign] Sending message 1 to', phone);
      const ok = await safeSend(chatId, text, greenApi);
      if (ok) {
        store.setState(greenInstanceDbId, phone, {
          lastSentIndex: 1,
          sequence,
          campaignId,
        });
        startedUsers++;
      }
    } finally {
      if (idx < list.length - 1 && delay > 0) {
        await sleep(delay);
      }
    }
  }

  console.log('[Campaign] Conversations started:', startedUsers);
  return { startedUsers };
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
    shouldSkipUser(user, phone) {
      const existing = state.getState(greenInstanceDbId, phone);
      if (existing != null && existing.lastSentIndex >= 1) {
        const cid = String(existing.campaignId || '');
        if (!cid.startsWith('test-')) {
          console.log('[Campaign] Skipping', phone, 'conversation already started');
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
    userState = store.getState(greenInstanceDbId, key);
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
  const ok = await safeSend(chatId, text, greenApi);
  if (ok) {
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
