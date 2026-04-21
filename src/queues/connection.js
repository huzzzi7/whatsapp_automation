/**
 * Redis connection for BullMQ (ioredis).
 * Use REDIS_URL string (e.g. Upstash rediss://…) — ioredis parses it; avoids manual host/port bugs.
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

const connectionString = redisUrlRaw != null && String(redisUrlRaw).trim() !== '' ? String(redisUrlRaw).trim() : DEFAULT_REDIS_URL;
const isTls = connectionString.startsWith('rediss://');
/** When true, BullMQ skips the Redis 6.2+ recommendation warning (not a substitute for upgrading Redis). */
const bullMqSkipVersionCheck =
  String(process.env.BULLMQ_SKIP_REDIS_VERSION_CHECK || '').toLowerCase() === 'true';

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

function hostnameForLog(urlString) {
  try {
    return new URL(urlString.replace(/^rediss:\/\//i, 'https://').replace(/^redis:\/\//i, 'http://')).hostname;
  } catch {
    return 'unknown';
  }
}

rlog.info(
  { event: 'redis_config_loaded', host: hostnameForLog(connectionString) },
  'Redis connection config loaded',
);

module.exports = { connectionOptions, connectionString, isTls, bullMqSkipVersionCheck };
