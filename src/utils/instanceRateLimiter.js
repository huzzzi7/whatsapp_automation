/**
 * In-memory per-instance fixed-window rate limiter.
 *
 * Keyed by Green API instanceId string so each WhatsApp instance has its own bucket.
 * NOTE: This is per-process memory; running multiple Node processes will create multiple buckets.
 */
const instanceSendLog = new Map();
const instanceMutex = new Map();

const DEFAULT_MAX = Math.max(1, parseInt(process.env.RATE_LIMIT_MESSAGES_PER_WINDOW || '3', 10));
const DEFAULT_WINDOW = Math.max(1000, parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10));

const RATE_LIMIT_MAX = DEFAULT_MAX;
const RATE_LIMIT_WINDOW_MS = DEFAULT_WINDOW;

function sleep(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

function getMutexTail(id) {
  const tail = instanceMutex.get(id);
  return tail && typeof tail.then === 'function' ? tail : Promise.resolve();
}

/**
 * Wait until sending is allowed for this instance.
 * Fixed window: allow maxPerWindow sends per windowMs.
 *
 * @param {string} instanceId
 * @param {number} [maxPerWindow=DEFAULT_MAX]
 * @param {number} [windowMs=DEFAULT_WINDOW]
 */
async function waitForRateLimit(instanceId, maxPerWindow = DEFAULT_MAX, windowMs = DEFAULT_WINDOW) {
  const id = String(instanceId || '').trim();
  if (!id) return;

  const prior = getMutexTail(id);
  let release;
  const mine = new Promise((resolve) => {
    release = resolve;
  });
  const chained = prior.then(() => mine);
  instanceMutex.set(id, chained);

  await prior;

  try {
    const WINDOW_MS = Math.max(1, Math.floor(Number(windowMs) || 60000));
    const MAX_PER_WINDOW = Math.max(1, Math.floor(Number(maxPerWindow) || 3));

    const now = Date.now();

    if (!instanceSendLog.has(id)) {
      instanceSendLog.set(id, { count: 0, windowStart: now });
    }

    const entry = instanceSendLog.get(id);

    if (now - entry.windowStart >= WINDOW_MS) {
      entry.count = 0;
      entry.windowStart = now;
    }

    if (entry.count >= MAX_PER_WINDOW) {
      const elapsed = now - entry.windowStart;
      const waitMs = WINDOW_MS - elapsed + 500;
      await sleep(waitMs);
      entry.count = 0;
      entry.windowStart = Date.now();
    }

    entry.count += 1;
  } finally {
    release();
    // Only delete if nobody chained after us.
    if (instanceMutex.get(id) === chained) {
      instanceMutex.delete(id);
    }
  }
}

function reset() {
  instanceSendLog.clear();
  instanceMutex.clear();
}

module.exports = { waitForRateLimit, reset, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS };

