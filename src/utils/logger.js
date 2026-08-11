/**
 * Central structured logger: JSON file (rotating) + console (pretty in dev TTY).
 * Set DEBUG_LOGS=true to enable debug-level output on both destinations.
 *
 * server and coordinatorWorker run as separate PM2 processes, and campaign send loops can run on
 * EITHER one (see campaignWorkerLock.js) — so every process needs its activity captured, but only
 * one process may ever own the rotating log file. Two independent rotating-file-stream instances
 * pointed at the same file used to race each other on rotation (each renamed app.log on its own
 * schedule with no coordination) and silently dropped/overwrote log history.
 *
 * Fix: the main server entrypoint owns logs/app.log and also runs a small local TCP "log
 * collector" that other processes forward their log lines to over 127.0.0.1. Only the file-owning
 * process ever writes to disk, so there is exactly one writer and one unified file no matter which
 * process actually did the work.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
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

const entryBase = path.basename(process.argv[1] || 'app', '.js');
const isFileOwner = entryBase === 'server';
const LOG_COLLECTOR_PORT = Number(process.env.LOG_COLLECTOR_PORT) || 9312;

/**
 * Runs only in the server process: owns the actual rotating file, and accepts forwarded log lines
 * from any other local process over TCP, writing them straight into the same file stream.
 */
function ownFileAndCollectForwardedLogs() {
  const fileStream = rfs.createStream('app.log', {
    interval: '1d',
    path: LOG_DIR,
    size: '15M',
    maxFiles: 14,
    compress: false,
  });

  const collector = net.createServer((socket) => {
    socket.on('data', (chunk) => fileStream.write(chunk));
    socket.on('error', () => {}); // a client disconnecting mid-write isn't this process's problem
  });
  collector.on('error', (err) => {
    // Most likely this process is restarting and the prior listener hasn't released the port yet.
    // Retry rather than crash the app over a logging concern.
    if (err.code === 'EADDRINUSE') {
      setTimeout(() => {
        try {
          collector.close();
        } catch {
          /* ignore */
        }
        collector.listen(LOG_COLLECTOR_PORT, '127.0.0.1');
      }, 1000);
    }
  });
  collector.listen(LOG_COLLECTOR_PORT, '127.0.0.1');

  return fileStream;
}

/**
 * Runs in every other process: forwards log lines to the server process's collector. Buffers in
 * memory (capped) while disconnected and auto-reconnects, so a brief restart of the server process
 * doesn't crash or block this one. If this process itself restarts while disconnected, whatever
 * was queued is lost from app.log — but PM2's own per-process stdout capture (e.g.
 * coordinatorWorker-out.log) still has it independently, since that's unaffected by any of this.
 */
function forwardLogsToCollector() {
  const MAX_QUEUED = 5000;
  let socket = null;
  let connecting = false;
  let queue = [];

  function connect() {
    if (connecting || socket) return;
    connecting = true;
    const s = net.createConnection(LOG_COLLECTOR_PORT, '127.0.0.1');
    s.on('connect', () => {
      connecting = false;
      socket = s;
      const pending = queue;
      queue = [];
      for (const chunk of pending) socket.write(chunk);
    });
    s.on('error', () => {});
    s.on('close', () => {
      connecting = false;
      socket = null;
      setTimeout(connect, 2000);
    });
  }
  connect();

  return {
    write(chunk) {
      if (socket) {
        socket.write(chunk);
      } else {
        queue.push(chunk);
        if (queue.length > MAX_QUEUED) queue.shift();
      }
      return true;
    },
  };
}

const fileStream = isFileOwner ? ownFileAndCollectForwardedLogs() : forwardLogsToCollector();

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
