/**
 * Central structured logger: JSON file (rotating) + console (pretty in dev TTY).
 * Set DEBUG_LOGS=true to enable debug-level output on both destinations.
 */
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const rfs = require('rotating-file-stream');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const DEBUG_LOGS = String(process.env.DEBUG_LOGS || '').toLowerCase() === 'true';
const rootLevel = DEBUG_LOGS ? 'debug' : 'info';
const isProduction = process.env.NODE_ENV === 'production';
const usePrettyConsole = !isProduction && process.stdout.isTTY;

const fileStream = rfs.createStream('app.log', {
  interval: '1d',
  path: LOG_DIR,
  size: '15M',
  maxFiles: 14,
  compress: false,
});

const streams = [{ level: rootLevel, stream: fileStream }];

if (usePrettyConsole) {
  const pretty = require('pino-pretty');
  streams.push({
    level: rootLevel,
    stream: pretty({
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    }),
  });
} else {
  streams.push({ level: rootLevel, stream: process.stdout });
}

const root = pino(
  {
    level: rootLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  pino.multistream(streams),
);

/**
 * @param {'server'|'worker'|'webhook'|'app'} service
 * @param {Record<string, unknown>} [defaults] e.g. { campaignId, chatId }
 */
function createLogger(service, defaults = {}) {
  return root.child({ service, ...defaults });
}

/** Default logger for HTTP / campaign API process */
const logger = createLogger('server');

module.exports = { logger, createLogger, root, LOG_DIR };
