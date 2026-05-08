/**
 * GreenAPI WhatsApp send: single message by chatId.
 * URL and auth from config; uses axios for POST.
 */
const axios = require('axios');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random integer in [3000, 8000] for human typing simulation (Phase 2.2). */
function randomTypingMs() {
  return Math.floor(Math.random() * (8000 - 3000 + 1)) + 3000;
}

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
 * Send Green API typing indicator, then wait a randomized duration (3000–8000 ms).
 * HTTP failures are logged; local delay still runs so callers are not blocked by network errors.
 * @param {{ instanceId: string, apiToken: string, baseUrl: string, chatId: string, typingMs?: number }} params
 * Same auth fields as sendMessage. Optional typingMs is validated (3000–8000, else treated as invalid);
 * the actual wait is always randomized in [3000, 8000] per Phase 2.2.
 * @returns {Promise<{ typingMs: number }>}
 */
async function simulateTyping(params) {
  const { instanceId, apiToken, baseUrl, chatId, typingMs: typingMsParam } = params || {};
  if (!instanceId || !apiToken || !baseUrl || !chatId) {
    throw new Error('simulateTyping requires instanceId, apiToken, baseUrl, and chatId');
  }

  if (typingMsParam != null) {
    const n = Math.floor(Number(typingMsParam));
    if (!Number.isFinite(n) || n < 3000 || n > 8000) {
      console.warn('[GreenAPI] simulateTyping: typingMs must be 3000–8000; ignoring invalid value');
    }
  }

  const typingMs =
    typingMsParam && typingMsParam >= 3000 && typingMsParam <= 8000
      ? typingMsParam
      : randomTypingMs();
  const root = String(baseUrl).replace(/\/$/, '');
  const url = `${root}/waInstance${instanceId}/sendTyping/${apiToken}`;

  try {
    const res = await axios.post(
      url,
      { chatId, typingTime: typingMs },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    if (res.status < 200 || res.status >= 300) {
      console.warn('[GreenAPI] simulateTyping: sendTyping non-2xx', res.status, res.data);
    }
  } catch (err) {
    const msg = err.response
      ? `GreenAPI ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.warn('[GreenAPI] simulateTyping: sendTyping failed, continuing with local delay:', msg);
  }

  await delay(typingMs);
  return { typingMs };
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

/**
 * Clears all pending messages from the Green API outgoing queue for this instance.
 * GET /waInstance<instanceId>/clearMessagesQueue/<apiToken>
 * Phase 4.3 — called on instance reconnect or number change.
 * @param {{ instanceId: string, apiToken: string, baseUrl: string }} greenApiConfig
 * @returns {Promise<object>} Green API response data
 */
async function clearMessagesQueue({ instanceId, apiToken, baseUrl }) {
  if (!instanceId || !apiToken || !baseUrl) {
    throw new Error('clearMessagesQueue requires instanceId, apiToken, and baseUrl');
  }
  const root = String(baseUrl).replace(/\/$/, '');
  const url = `${root}/waInstance${instanceId}/clearMessagesQueue/${apiToken}`;
  try {
    const res = await axios.get(url, { timeout: 30000 });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`clearMessagesQueue returned ${res.status}: ${JSON.stringify(res.data)}`);
    }
    console.log(
      `[GreenAPI] clearMessagesQueue success for instanceId=${instanceId}:`,
      JSON.stringify(res.data).slice(0, 200),
    );
    return res.data;
  } catch (err) {
    const msg = err.response
      ? `GreenAPI ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error(`[GreenAPI] clearMessagesQueue failed for instanceId=${instanceId}:`, msg);
    throw new Error(msg);
  }
}

async function getStateInstance(greenApi) {
  const { instanceId, apiToken, baseUrl } = greenApi;
  const url = `${baseUrl}/waInstance${instanceId}/getStateInstance/${apiToken}`;
  const resp = await axios.get(url, { timeout: 10000 });
  return resp.data; // { stateInstance: "authorized" | "notAuthorized" | ... }
}

module.exports = {
  sendMessage,
  simulateTyping,
  receiveNotification,
  deleteNotification,
  clearMessagesQueue,
  getStateInstance,
};

/** Phase 2.2 self-test: `node src/greenapi.js` — five runs, mock chatId, logs duration and timestamps. */
async function runSimulateTypingSelfTest() {
  const mockChatId = '79999999999@c.us';
  const cfg = {
    instanceId: process.env.GREEN_INSTANCE_ID || '0000000000',
    apiToken: process.env.GREEN_API_TOKEN || 'mock-token',
    baseUrl: process.env.GREEN_API_BASE_URL || 'https://api.green-api.com',
  };
  for (let i = 1; i <= 5; i += 1) {
    console.log(`\n[GreenAPI] simulateTyping self-test run ${i}/5`);
    const before = Date.now();
    console.log('[GreenAPI] before:', new Date(before).toISOString());
    const { typingMs } = await simulateTyping({ ...cfg, chatId: mockChatId });
    const after = Date.now();
    const elapsed = after - before;
    console.log('[GreenAPI] typingMs (randomized):', typingMs);
    console.log('[GreenAPI] after:', new Date(after).toISOString());
    console.log('[GreenAPI] elapsedMs:', elapsed, '(expect ≥ typingMs; extra if API round-trip slow)');
    if (elapsed < 3000) {
      console.warn('[GreenAPI] self-test: elapsed shorter than minimum typing window');
    }
  }
  console.log('\n[GreenAPI] simulateTyping self-test finished');
}

if (require.main === module) {
  runSimulateTypingSelfTest().catch((e) => {
    console.error('[GreenAPI] self-test error:', e);
    process.exitCode = 1;
  });
}
