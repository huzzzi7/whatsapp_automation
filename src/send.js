/**
 * Send full message sequence to all users with per-message and per-user delays.
 * Attaches sequence per user if not already set; logs errors and continues or aborts.
 */
const { toChatId } = require('./phone');
const { buildSequence } = require('./messages');
const { sendMessage } = require('./greenapi');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send all users their message sequences. Users must have .sequence (string[])
 * or will be built from config.messageTemplates. Uses config for GreenAPI and delays.
 * @param {Array<{ phone: string, university?: string, city?: string, link?: string, sequence?: string[] }>} users
 * @param {Object} config - Full config (greenApi, delays, messageTemplates)
 * @param {{ dryRun?: boolean }} opts - dryRun: if true, skip GreenAPI calls and only run delays (for preview)
 */
async function sendAllUsers(users, config, opts = {}) {
  const { dryRun = false } = opts;
  const { greenApi, delays, messageTemplates } = config;
  if (!greenApi || !greenApi.instanceId || !greenApi.apiToken) {
    throw new Error('sendAllUsers requires config.greenApi from a saved Green instance');
  }
  const betweenMessages = delays.betweenMessages || 1500;
  const betweenUsers = delays.betweenUsers || 4000;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const sequence = user.sequence || buildSequence(user, messageTemplates);
    const seqLen = sequence.length;
    const chatId = toChatId(user.phone);
    if (!chatId) {
      console.error(`[Send] Skip user (invalid phone): ${user.phone}`);
      continue;
    }

    for (let j = 0; j < seqLen; j++) {
      const text = sequence[j];
      if (text == null || String(text).trim() === '') continue;

      if (!dryRun) {
        try {
          await sendMessage(chatId, text, greenApi);
          console.log(`[Send] ${user.phone} message ${j + 1}/${seqLen} ok`);
        } catch (err) {
          console.error(`[Send] ${user.phone} message ${j + 1}/${seqLen} failed:`, err.message);
        }
      }
      await delay(betweenMessages);
    }

    if (i < users.length - 1) await delay(betweenUsers);
  }
}

module.exports = { sendAllUsers, delay };
