#!/usr/bin/env node
/**
 * Tail logs/app.log: rotation-safe follow, optional campaign filter, optional session tee.
 *
 * ## Rotation handling
 * - Every POLL_MS we stat logs/app.log.
 * - If size < read cursor → file was truncated or replaced (typical rotate) → reopen and continue from byte 0
 *   so nothing written to the new file is skipped.
 * - If st.ino is non-zero and differs from last open → same reopen (handles rename/replace without size shrink race).
 * - If the file is missing → drop fd; when it comes back, open from byte 0 and stream everything new.
 *
 * ## Buffering
 * - Only a single `carry` string may hold an incomplete final line between reads; completed lines are emitted
 *   immediately (append-only to stdout / session file). We never clear prior terminal output.
 *
 * Usage:
 *   npm run logs
 *   node scripts/tail-app-log.js
 *   node scripts/tail-app-log.js campaign-<uuid-or-substring>
 *   node scripts/tail-app-log.js --session
 *   node scripts/tail-app-log.js campaign-abc --session
 *   node scripts/tail-app-log.js --out=logs/custom-live.log
 *   node scripts/tail-app-log.js --out=auto
 *   node scripts/tail-app-log.js --help
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const PRIMARY = path.join(LOG_DIR, 'app.log');
const DEFAULT_SESSION = path.join(LOG_DIR, 'live-session.log');
const POLL_MS = 250;
const READ_BUF = 256 * 1024;
const START_TAIL_LINES = 100;
const TAIL_SCAN_BYTES = 512 * 1024;
const WAIT_MAX_MS = 120_000;

function liveCaptureAutoPath() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
  return path.join(LOG_DIR, `live-capture-${stamp}.log`);
}

function parseArgs(argv) {
  let campaignFilter = null;
  let sessionPath = null;
  let help = false;
  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      help = true;
    } else if (a === '--session' || a === '--tee') {
      sessionPath = DEFAULT_SESSION;
    } else if (a.startsWith('--session=')) {
      const raw = a.slice('--session='.length);
      sessionPath = raw === 'auto' ? liveCaptureAutoPath() : path.resolve(process.cwd(), raw);
    } else if (a.startsWith('--out=')) {
      const raw = a.slice('--out='.length);
      sessionPath = raw === 'auto' ? liveCaptureAutoPath() : path.resolve(process.cwd(), raw);
    } else if (!a.startsWith('-')) {
      campaignFilter = a;
    }
  }
  return { campaignFilter, sessionPath, help };
}

/** Stable while the same inode; null when ino is 0 (then rely on size-shrink only). */
function fileFingerprint(st) {
  if (!st) return null;
  if (st.ino) return String(st.ino);
  return null;
}

function readLastNLines(filePath, maxLines, maxScan) {
  if (!fs.existsSync(filePath)) return '';
  const st = fs.statSync(filePath);
  if (st.size === 0) return '';
  const toRead = Math.min(st.size, maxScan);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(toRead);
    fs.readSync(fd, buf, 0, toRead, st.size - toRead);
    let text = buf.toString('utf8');
    if (st.size > maxScan) {
      const firstNl = text.indexOf('\n');
      if (firstNl !== -1) text = text.slice(firstNl + 1);
    }
    const lines = text.split('\n');
    const nonempty = lines.filter((line, i, arr) => i < arr.length - 1 || line !== '');
    return nonempty.slice(-maxLines).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  try {
    Atomics.wait(ia, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* fallback */
    }
  }
}

function waitForPrimary() {
  const start = Date.now();
  while (Date.now() - start < WAIT_MAX_MS) {
    if (fs.existsSync(PRIMARY)) return;
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch {
      /* ignore */
    }
    sleepSync(1000);
  }
  process.stderr.write(`Timed out waiting for ${PRIMARY}\n`);
  process.exit(1);
}

function main() {
  const { campaignFilter, sessionPath, help } = parseArgs(process.argv.slice(2));
  if (help) {
    process.stderr.write(`Usage:
  node scripts/tail-app-log.js [options] [campaignId-substring]

Options:
  --session, --tee     Append filtered stream to ${path.relative(process.cwd(), DEFAULT_SESSION)}
  --session=PATH       Append to explicit path (--session=auto → logs/live-capture-YYYYMMDD-HHmmss.log)
  --out=PATH           Same as --session=PATH (--out=auto → timestamped file under logs/)
  -h, --help           This help

Startup:
  - Prints only the last ${START_TAIL_LINES} lines of logs/app.log, then follows new bytes.

Rotation:
  - Reopens when size < cursor, or when inode (if available) changes — continues from byte 0 of the new file.

Examples:
  node scripts/tail-app-log.js
  node scripts/tail-app-log.js campaign-f47ac10b-58cc-4372-a567-0e02b2c3d479
  node scripts/tail-app-log.js --session
  node scripts/tail-app-log.js campaign-abc --out=logs/my-run.log
`);
    process.exit(0);
  }

  /** @type {import('fs').WriteStream | null} */
  let sessionStream = null;
  if (sessionPath) {
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    sessionStream = fs.createWriteStream(sessionPath, { flags: 'a' });
    process.stderr.write(`Also writing filtered stream to ${sessionPath}\n`);
  }

  const emit = (line) => {
    const s = line.endsWith('\n') ? line : `${line}\n`;
    if (campaignFilter && !s.includes(campaignFilter)) return;
    process.stdout.write(s);
    if (sessionStream) sessionStream.write(s);
  };

  waitForPrimary();

  process.stderr.write(
    `Tailing ${PRIMARY}${campaignFilter ? ` (filter: ${campaignFilter})` : ''}. Ctrl+C to stop.\n`,
  );

  const initial = readLastNLines(PRIMARY, START_TAIL_LINES, TAIL_SCAN_BYTES);
  if (initial) emit(initial + '\n');

  let fd = null;
  let position = 0;
  /** @type {string | null} */
  let lastInodeFp = null;
  let carry = '';

  const closeFd = () => {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      fd = null;
    }
  };

  const openFromStart = (reason) => {
    closeFd();
    carry = '';
    if (reason) process.stderr.write(`\n--- ${reason}: reopened ${PRIMARY} ---\n`);
    if (!fs.existsSync(PRIMARY)) {
      lastInodeFp = null;
      position = 0;
      return;
    }
    const st = fs.statSync(PRIMARY);
    fd = fs.openSync(PRIMARY, 'r');
    position = 0;
    lastInodeFp = fileFingerprint(st);
  };

  const openAtEnd = () => {
    closeFd();
    const st = fs.statSync(PRIMARY);
    fd = fs.openSync(PRIMARY, 'r');
    position = st.size;
    lastInodeFp = fileFingerprint(st);
  };

  openAtEnd();

  const pump = () => {
    try {
      if (!fs.existsSync(PRIMARY)) {
        closeFd();
        lastInodeFp = null;
        position = 0;
        carry = '';
        return;
      }

      const st = fs.statSync(PRIMARY);
      const fp = fileFingerprint(st);

      const sizeShrunk = fd != null && st.size < position;
      const inodeChanged = fp != null && lastInodeFp != null && fp !== lastInodeFp;

      if (fd == null) {
        openFromStart('log file appeared');
      } else if (sizeShrunk || inodeChanged) {
        openFromStart(
          sizeShrunk ? 'log truncated or rotated (size < cursor)' : 'log inode changed (rotation)',
        );
      }

      if (!fd) return;

      const stRead = fs.statSync(PRIMARY);
      if (stRead.size <= position) return;

      const chunkLen = Math.min(READ_BUF, stRead.size - position);
      const buf = Buffer.alloc(chunkLen);
      const n = fs.readSync(fd, buf, 0, chunkLen, position);
      if (n <= 0) return;
      position += n;

      carry += buf.toString('utf8', 0, n);
      const parts = carry.split('\n');
      carry = parts.pop() || '';
      for (const line of parts) {
        emit(line);
      }
    } catch (e) {
      process.stderr.write(`tail read error: ${e.message}\n`);
    }
  };

  const shutdown = () => {
    if (carry) {
      emit(carry);
      carry = '';
    }
    closeFd();
    if (sessionStream) {
      try {
        sessionStream.end();
      } catch {
        /* ignore */
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  setInterval(pump, POLL_MS);
  pump();
}

main();
