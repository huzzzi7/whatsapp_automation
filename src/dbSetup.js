/**
 * One-time / deploy helper: applies Prisma schema to MySQL via `prisma db push`.
 * Prisma Client cannot create tables; the CLI must run.
 *
 * Usage (from repo root, with DATABASE_URL set to MySQL):
 *   node src/dbSetup.js
 *   npm run db:push:node
 *
 * Do NOT import this from server.js for every request — run manually or from CI once.
 */
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const root = path.join(__dirname, '..');

function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Add it to .env or your hosting panel.');
    process.exit(1);
  }

  if (!/^mysql:\/\//i.test(url)) {
    console.warn(
      '[dbSetup] DATABASE_URL does not start with mysql:// — if you still use SQLite, switch provider in prisma/schema.prisma or update the URL.'
    );
  }

  console.log('[dbSetup] Running: prisma db push (creates/updates tables from schema.prisma)');
  try {
    execSync('npx prisma db push', {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env },
    });
    console.log('[dbSetup] Done.');
  } catch (e) {
    console.error('[dbSetup] prisma db push failed. Check DATABASE_URL, SSL, and MySQL user permissions.');
    process.exit(e.status ?? 1);
  }
}

main();
