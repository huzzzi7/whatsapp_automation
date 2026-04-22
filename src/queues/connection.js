/**
 * Redis connection for BullMQ (ioredis).
 * Use REDIS_URL string (e.g. Upstash rediss://…) — ioredis parses it; avoids manual host/port bugs.
 *
 * BullMQ instantiates IORedis as: new IORedis(url, rest) when opts has a `url` key (see node_modules/bullmq/.../redis-connection.js).
 * Single `bullMqConnection` object is used for Queue, Worker, and coordinator Worker so URL + TLS + options stay identical.
 */
require('dotenv').config();
const { createLogger } = require('../utils/logger');

const rlog = createLogger('worker');

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

const isProduction = process.env.NODE_ENV === 'production';
const redisUrlRaw = process.env.REDIS_URL;
if (isProduction && (redisUrlRaw == null || String(redisUrlRaw).trim() === '')) {
  throw new Error(
    'FATAL: REDIS_URL env var is required in production. BullMQ queues will not function without Redis.',
  );
}

const connectionString =
  redisUrlRaw != null && String(redisUrlRaw).trim() !== '' ? String(redisUrlRaw).trim() : DEFAULT_REDIS_URL;
const isTls = connectionString.startsWith('rediss://');
/** When true, BullMQ skips the Redis 6.2+ recommendation warning (not a substitute for upgrading Redis). */
const bullMqSkipVersionCheck =
  String(process.env.BULLMQ_SKIP_REDIS_VERSION_CHECK || '').toLowerCase() === 'true';

/**
 * Second-argument options for IORedis(url, options) — also merged into `bullMqConnection` (without duplicate `url`).
 * Used by greenQueueMonitor: new Redis(connectionString, connectionOptions)
 */
const connectionOptions = {
  ...(isTls ? { tls: {} } : {}),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
  retryStrategy(times) {
    const delay = Math.min(times * 500, 5000);
    rlog.warn({ event: 'redis_reconnecting', delayMs: delay, attempt: times }, 'Redis reconnecting');
    return delay;
  },
};

/**
 * One shared BullMQ / ioredis config: URL + all merge options (TLS, retries, etc.).
 * Matches the library pattern: new IORedis(bullMqConnection.url, { ...rest }).
 */
const bullMqConnection = {
  url: connectionString,
  ...connectionOptions,
};

function hostnameForLog(urlString) {
  try {
    return new URL(
      String(urlString).replace(/^rediss:\/\//i, 'https://').replace(/^redis:\/\//i, 'http://'),
    ).hostname;
  } catch {
    return 'unknown';
  }
}

/** For logs: host only, with middle obscured. */
function maskRedisHostForLog(urlString) {
  const h = hostnameForLog(urlString);
  if (!h || h === 'unknown') return h;
  if (h.length <= 3) return '***';
  return `***${h.slice(-Math.min(10, h.length - 1))}`;
}

rlog.info(
  { event: 'redis_config_loaded', host: hostnameForLog(connectionString) },
  'Redis connection config loaded',
);

module.exports = {
  connectionOptions,
  connectionString,
  bullMqConnection,
  isTls,
  bullMqSkipVersionCheck,
  hostnameForLog,
  maskRedisHostForLog,
};
