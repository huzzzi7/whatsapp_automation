#!/usr/bin/env node
/**
 * Pre-deployment env validation. Run: npm run check:env
 * Loads .env from repo root (same as server).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function trimVal(name) {
  const v = process.env[name];
  if (v == null) return null;
  return String(v).trim();
}

function pass(name) {
  console.log(`[PASS] ${name} = set`);
}

function fail(name) {
  console.error(`[FAIL] ${name} = MISSING (required)`);
}

function warn(name, detail) {
  console.warn(`[WARN] ${name} = not set (${detail})`);
}

let exitCode = 0;

const requiredNonEmpty = ['REDIS_URL', 'DB_HOST', 'DB_USER', 'DB_NAME', 'SESSION_SECRET'];
for (const name of requiredNonEmpty) {
  const t = trimVal(name);
  if (t == null || t === '') {
    fail(name);
    exitCode = 1;
  } else {
    pass(name);
  }
}

if (!Object.prototype.hasOwnProperty.call(process.env, 'DB_PASSWORD')) {
  fail('DB_PASSWORD');
  exitCode = 1;
} else {
  pass('DB_PASSWORD');
}

const recommended = [
  ['CORS_ORIGIN', 'default empty — browser CORS may block'],
];
for (const [name, detail] of recommended) {
  const t = trimVal(name);
  if (t == null || t === '') {
    warn(name, detail);
  } else {
    pass(name);
  }
}

process.exit(exitCode);
