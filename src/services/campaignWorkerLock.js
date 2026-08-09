/**
 * Distributed lock (Redis) so only one process ever runs a given campaign's send loop at a time.
 * CampaignCoordinator's `activeWorkerKeys` in-memory Set only guards within a single process —
 * `server` and `coordinatorWorker` are separate OS processes with separate memory, so without
 * this, both could independently kick a worker for the same campaign (server calls tryRunNext()
 * directly on campaign start/stop/etc, coordinatorWorker calls it on every BullMQ tick), doubling
 * the effective send rate and silently bypassing the configured pacing/rate limits.
 *
 * TTL + periodic renewal (rather than a permanent lock) so a crashed process's lock self-expires
 * instead of deadlocking the campaign forever.
 */
const Redis = require('ioredis');
const { connectionString, connectionOptions } = require('../queues/connection');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

// Deliberately does NOT reuse the shared BullMQ connectionOptions as-is: those set
// maxRetriesPerRequest: null so BullMQ's own commands queue and wait indefinitely for
// reconnection, which is right for queue reliability but wrong here — if Redis is briefly down,
// campaign sending must still proceed (unprotected) rather than hang forever waiting for a lock.
// Bounded retries make acquire fail fast so kickWorker can fall back to running unlocked.
const redis = new Redis(connectionString, { ...connectionOptions, maxRetriesPerRequest: 1, connectTimeout: 3000 });
redis.on('error', (err) => {
  log.error({ err: err?.message || String(err), event: 'campaign_lock_redis_error' }, 'Campaign lock Redis connection error');
});

const LOCK_PREFIX = 'campaign_worker_lock:';
const LOCK_TTL_MS = 45000;
const RENEW_INTERVAL_MS = 15000;

// Only renew/release a lock this process actually still owns — guards against clobbering a lock
// that expired here and was legitimately re-acquired by another process in the meantime.
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end`;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const NOOP_LOCK = { release: async () => {} };

/**
 * @param {string} campaignId
 * @returns {Promise<{ release: () => Promise<void> } | null>} a lock handle to run with (real, or
 *   a no-op stand-in if Redis was unreachable — proceeds unprotected rather than blocking
 *   campaign sending on a Redis outage); null only when another process genuinely holds the lock.
 */
async function acquireCampaignWorkerLock(campaignId) {
  const key = LOCK_PREFIX + String(campaignId);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let ok;
  try {
    ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
  } catch (err) {
    log.warn(
      { err: err.message, event: 'campaign_lock_unavailable', campaignId },
      'Campaign lock unavailable (Redis unreachable), proceeding without cross-process protection',
    );
    return NOOP_LOCK;
  }
  if (ok !== 'OK') return null;

  const renewTimer = setInterval(() => {
    redis.eval(RENEW_SCRIPT, 1, key, token, LOCK_TTL_MS).catch((err) => {
      log.warn({ err: err.message, event: 'campaign_lock_renew_failed', campaignId }, 'Failed to renew campaign worker lock');
    });
  }, RENEW_INTERVAL_MS);
  if (typeof renewTimer.unref === 'function') renewTimer.unref();

  let released = false;
  async function release() {
    if (released) return;
    released = true;
    clearInterval(renewTimer);
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch (err) {
      log.warn({ err: err.message, event: 'campaign_lock_release_failed', campaignId }, 'Failed to release campaign worker lock');
    }
  }

  return { release };
}

module.exports = { acquireCampaignWorkerLock };
