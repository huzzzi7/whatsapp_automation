/**
 * Green API queue monitor — Phase 4.1 / 4.2
 * Checks remote Green API message queue depth before sending.
 * Caches result per instance for GREEN_QUEUE_CACHE_MS (default 5000ms)
 * to avoid hammering Green API on every BullMQ job.
 * Phase 4.2: Redis pause flag per instance when hard threshold exceeded.
 */
const axios = require('axios');
const Redis = require('ioredis');
const { connectionString, connectionOptions } = require('../queues/connection');

/** @type {Map<string, { depth: number, fetchedAt: number }>} */
const depthCache = new Map();

let _redis = null;
function getRedisClient() {
  if (!_redis) {
    _redis = new Redis(connectionString, connectionOptions);
    _redis.on('error', (err) => console.error('[GreenQueueMonitor] Redis error:', err.message));
  }
  return _redis;
}

function getCacheTtlMs() {
  const raw = parseInt(process.env.GREEN_QUEUE_CACHE_MS || '5000', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
}

function getGreenQueueMax() {
  const raw = parseInt(process.env.GREEN_QUEUE_MAX || '20', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 20;
}

function getGreenQueueHardMax() {
  const raw = parseInt(process.env.GREEN_QUEUE_HARD_MAX || '40', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 40;
}

async function getGreenQueueDepth(instanceId, apiToken, baseUrl) {
  const cached = depthCache.get(instanceId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < getCacheTtlMs()) {
    return cached.depth;
  }

  const root = String(baseUrl).replace(/\/$/, '');
  const url = `${root}/waInstance${instanceId}/showMessagesQueue/${apiToken}`;

  try {
    const res = await axios.get(url, { timeout: 30000 });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`showMessagesQueue returned ${res.status}: ${JSON.stringify(res.data)}`);
    }

    const data = res.data;
    let depth;
    if (typeof data === 'number') {
      depth = data;
    } else if (data && typeof data.totalQueueSize === 'number') {
      depth = data.totalQueueSize;
    } else if (data && typeof data.queueSize === 'number') {
      depth = data.queueSize;
    } else if (Array.isArray(data)) {
      depth = data.length;
    } else {
      console.warn(
        '[GreenQueueMonitor] Unrecognized showMessagesQueue response shape:',
        JSON.stringify(data).slice(0, 300),
      );
      throw new Error('showMessagesQueue: unrecognized response shape');
    }

    depthCache.set(instanceId, { depth, fetchedAt: Date.now() });

    const max = getGreenQueueMax();
    if (depth >= max) {
      console.warn(
        `[GreenQueueMonitor] WARNING: instanceId=${instanceId} greenQueue=${depth} >= max=${max}`,
      );
    }

    return depth;
  } catch (err) {
    console.error(
      `[GreenQueueMonitor] Failed to get queue depth for instanceId=${instanceId}:`,
      err.message,
    );
    throw err;
  }
}

/** Used by Task 4.3 (ClearMessagesQueue on reconnect) */
function clearDepthCache(instanceId) {
  depthCache.delete(instanceId);
  console.log(`[GreenQueueMonitor] Cache cleared for instanceId=${instanceId}`);
}

async function setPauseFlag(instanceId) {
  try {
    const redis = getRedisClient();
    const key = `bullmq:pause:green:${instanceId}`;
    await redis.set(key, '1', 'EX', 35);
    console.warn(`[GreenQueueMonitor] HARD PAUSE set for instanceId=${instanceId} (TTL 35s)`);
  } catch (err) {
    console.error('[GreenQueueMonitor] Failed to set pause flag:', err.message);
  }
}

async function isPaused(instanceId) {
  try {
    const redis = getRedisClient();
    const key = `bullmq:pause:green:${instanceId}`;
    const val = await redis.get(key);
    return val === '1';
  } catch (err) {
    console.error('[GreenQueueMonitor] Failed to check pause flag:', err.message);
    return false;
  }
}

async function clearPauseFlag(instanceId) {
  try {
    const redis = getRedisClient();
    const key = `bullmq:pause:green:${instanceId}`;
    await redis.del(key);
    console.log(`[GreenQueueMonitor] Pause flag cleared for instanceId=${instanceId}`);
  } catch (err) {
    console.error('[GreenQueueMonitor] Failed to clear pause flag:', err.message);
  }
}

module.exports = {
  getGreenQueueDepth,
  getGreenQueueMax,
  getGreenQueueHardMax,
  clearDepthCache,
  setPauseFlag,
  isPaused,
  clearPauseFlag,
};
