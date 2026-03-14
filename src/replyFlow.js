/**
 * Reply-driven flow: send only message 1 on campaign start; send next message on each reply.
 */
const { toChatId } = require('./phone');
const { buildSequence } = require('./messages');
const { sendMessage } = require('./greenapi');
const state = require('./state');

/**
 * Send one message via GreenAPI; catch errors, log, return success boolean.
 */
async function safeSend(chatId, message, config) {
  try {
    await sendMessage(chatId, message, config.greenApi);
    console.log('[GreenAPI] Message sent to', chatId);
    return true;
  } catch (err) {
    console.error('[GreenAPI] Failed sending to', chatId, err.message);
    return false;
  }
}

/**
 * Send only message 1 to each user and save state. Skip users who already have lastSentIndex >= 1.
 * @param {Array<{ phone: string, university?: string, city?: string, link?: string, sequence?: string[] }>} users
 * @param {Object} config - Full config (greenApi, delays, messageTemplates)
 * @returns {Promise<{ startedUsers: number }>}
 */
async function sendFirstMessageOnly(users, config) {
  const { messageTemplates } = config;
  const campaignId = 'campaign-' + Date.now();
  let startedUsers = 0;

  for (const user of users) {
    const phone = (user.phone || '').trim();
    if (!phone) continue;

    const existing = state.getState(phone);
    if (existing != null && existing.lastSentIndex >= 1) {
      console.log('[Campaign] Skipping', phone, 'conversation already started');
      continue;
    }

    const sequence = user.sequence || buildSequence(user, messageTemplates);
    if (!sequence || sequence.length !== 6) {
      console.warn('[Campaign] Invalid message sequence for', phone);
      continue;
    }

    const chatId = toChatId(phone);
    if (!chatId) continue;

    const text = sequence[0];
    if (text == null || String(text).trim() === '') continue;

    console.log('[Campaign] Sending message 1 to', phone);
    const ok = await safeSend(chatId, text, config);
    if (ok) {
      state.setState(phone, {
        lastSentIndex: 1,
        sequence,
        campaignId,
      });
      startedUsers++;
    }
  }

  console.log('[Campaign] Conversations started:', startedUsers);
  return { startedUsers };
}

/**
 * When a user replies: send the next message (sequence[lastSentIndex]) and increment lastSentIndex.
 * Ignore if user not in state or lastSentIndex >= 6. Increment only after successful send.
 * @param {string} phone - Normalized phone (digits)
 * @param {Object} config - Full config (greenApi, messageTemplates)
 */
async function onIncomingReply(phone, config) {
  const normalized = String(phone || '').replace(/\D/g, '');
  if (!normalized) return;

  const userState = state.getState(normalized);
  if (userState == null) {
    console.log('[ReplyFlow] Unknown phone ignored:', normalized);
    return;
  }
  if (userState.lastSentIndex >= 6) return;

  const nextIndex = userState.lastSentIndex;
  const sequence = userState.sequence;
  if (!sequence || nextIndex >= sequence.length) {
    console.error('[State] Invalid conversation state for', normalized);
    return;
  }

  const text = sequence[nextIndex];
  if (text == null || String(text).trim() === '') {
    state.updateLastSent(normalized, nextIndex + 1);
    return;
  }

  const chatId = toChatId(normalized);
  if (!chatId) return;

  console.log('[ReplyFlow] Sending message', nextIndex + 1, 'to', normalized);
  const ok = await safeSend(chatId, text, config);
  if (ok) {
    state.updateLastSent(normalized, nextIndex + 1);
    if (nextIndex + 1 === 6) {
      console.log('[ReplyFlow] Conversation completed for', normalized);
    }
  }
}

module.exports = {
  sendFirstMessageOnly,
  onIncomingReply,
};
