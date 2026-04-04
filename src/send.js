/**
 * Send full message sequence to all users with per-message and per-user delays.
 * Attaches sequence per user if not already set; logs errors and continues or aborts.
 *
 * When opts.greenInstanceDbId is set (e.g. POST /api/send), only the first non-empty
 * message per user is sent and production conversation state is written so webhooks
 * can continue the sequence. When omitted (e.g. CLI), the full sequence is sent (legacy).
 */
const { normalizePhone, toChatId } = require('./phone');
const { buildSequence } = require('./messages');
const { sendMessage } = require('./greenapi');
const state = require('./state');
const appConfig = require('../config');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Array<{ phone: string, university?: string, city?: string, link?: string, group?: string, sequence?: string[] }>} users
 * @param {Object} config - Full config (greenApi, delays, messageTemplates)
 * @param {{ dryRun?: boolean, greenInstanceDbId?: string }} opts
 */
async function sendAllUsers(users, config, opts = {}) {
  const { dryRun = false, greenInstanceDbId = null } = opts;
  const { greenApi, delays, messageTemplates } = config;
  if (!greenApi || !greenApi.instanceId || !greenApi.apiToken) {
    throw new Error('sendAllUsers requires config.greenApi from a saved Green instance');
  }
  const betweenMessages = delays.betweenMessages || 1500;
  const betweenUsers = delays.betweenUsers || 4000;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const phoneDigits = normalizePhone(String(user.phone || '').trim(), appConfig.defaultCountryCode);
    if (!phoneDigits) {
      console.error(`[Send] Skip user (invalid phone): ${user.phone}`);
      continue;
    }

    const sequence = user.sequence || buildSequence(user, messageTemplates);
    const seqLen = sequence.length;
    const chatId = toChatId(phoneDigits);
    if (!chatId) {
      console.error(`[Send] Skip user (invalid phone): ${user.phone}`);
      continue;
    }

    if (greenInstanceDbId) {
      let firstJ = -1;
      for (let j = 0; j < seqLen; j++) {
        const t = sequence[j];
        if (t != null && String(t).trim() !== '') {
          firstJ = j;
          break;
        }
      }
      if (firstJ < 0) {
        console.error(`[Send] Skip user (no messages in sequence): ${phoneDigits}`);
        continue;
      }
      if (!dryRun) {
        try {
          await sendMessage(chatId, sequence[firstJ], greenApi);
          console.log(
            `[Send] ${phoneDigits} reply-driven: first outbound ${firstJ + 1}/${seqLen} ok (automation enabled)`,
          );
          state.setState(greenInstanceDbId, phoneDigits, {
            lastSentIndex: firstJ + 1,
            sequence,
            campaignId: `send-${Date.now()}`,
          });
        } catch (err) {
          console.error(`[Send] ${phoneDigits} first message failed:`, err.message);
        }
      }
      if (i < users.length - 1) await delay(betweenUsers);
      continue;
    }

    for (let j = 0; j < seqLen; j++) {
      const text = sequence[j];
      if (text == null || String(text).trim() === '') continue;

      if (!dryRun) {
        try {
          await sendMessage(chatId, text, greenApi);
          console.log(`[Send] ${phoneDigits} message ${j + 1}/${seqLen} ok`);
        } catch (err) {
          console.error(`[Send] ${phoneDigits} message ${j + 1}/${seqLen} failed:`, err.message);
        }
      }
      await delay(betweenMessages);
    }

    if (i < users.length - 1) await delay(betweenUsers);
  }
}

module.exports = { sendAllUsers, delay };
