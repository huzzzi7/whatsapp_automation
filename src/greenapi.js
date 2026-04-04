/**
 * GreenAPI WhatsApp send: single message by chatId.
 * URL and auth from config; uses axios for POST.
 */
const axios = require('axios');

async function sendMessageWithRetry(url, body, retries = 2) {
  try {
    const res = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GreenAPI returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  } catch (err) {
    if (retries > 0) {
      console.log('[GreenAPI] Retry sending...', retries);
      await new Promise((r) => setTimeout(r, 3000));
      return sendMessageWithRetry(url, body, retries - 1);
    }

    const msg = err.response
      ? `GreenAPI ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;

    throw new Error(msg);
  }
}

/**
 * Send one text message via GreenAPI.
 * @param {string} chatId - e.g. "447123456789@c.us"
 * @param {string} text - Message body
 * @param {Object} greenApiConfig - { instanceId, apiToken, baseUrl }
 * @returns {Promise<void>} Resolves on success; rejects with Error (or axios error) on failure
 */
async function sendMessage(chatId, text, greenApiConfig) {
  const { instanceId, apiToken, baseUrl } = greenApiConfig;
  if (!instanceId || !apiToken) {
    throw new Error('GreenAPI config missing: instanceId and apiToken are required (configure a Green instance in Settings)');
  }

  const url = `${baseUrl}/waInstance${instanceId}/sendMessage/${apiToken}`;
  const body = { chatId, message: text };

  await sendMessageWithRetry(url, body);
}

/**
 * Receive one incoming notification from GreenAPI queue (polling). Waits up to receiveTimeout seconds.
 * @param {Object} greenApiConfig - { instanceId, apiToken, baseUrl }
 * @param {number} receiveTimeout - Seconds to wait (5-60, default 5)
 * @returns {Promise<{ receiptId: number, body: Object }|null>} Notification or null if timeout/empty
 */
async function receiveNotification(greenApiConfig, receiveTimeout = 5) {
  const { instanceId, apiToken, baseUrl } = greenApiConfig;
  if (!instanceId || !apiToken) {
    throw new Error('GreenAPI config missing: instanceId and apiToken are required (configure a Green instance in Settings)');
  }
  const url = `${baseUrl}/waInstance${instanceId}/receiveNotification/${apiToken}?receiveTimeout=${receiveTimeout}`;
  try {
    const res = await axios.get(url, { timeout: (receiveTimeout + 5) * 1000 });
    if (res.data && res.data.receiptId != null) return res.data;
    return null;
  } catch (err) {
    const msg = err.response
      ? `GreenAPI ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(msg);
  }
}

/**
 * Delete a notification from the queue after processing (for polling flow).
 * @param {number} receiptId - From receiveNotification response
 * @param {Object} greenApiConfig - { instanceId, apiToken, baseUrl }
 */
async function deleteNotification(receiptId, greenApiConfig) {
  const { instanceId, apiToken, baseUrl } = greenApiConfig;
  if (!instanceId || !apiToken) {
    throw new Error('GreenAPI config missing: instanceId and apiToken are required (configure a Green instance in Settings)');
  }
  const url = `${baseUrl}/waInstance${instanceId}/deleteNotification/${apiToken}/${receiptId}`;
  try {
    await axios.delete(url, { timeout: 10000 });
  } catch (err) {
    const msg = err.response
      ? `GreenAPI ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    throw new Error(msg);
  }
}

module.exports = { sendMessage, receiveNotification, deleteNotification };
