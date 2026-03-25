/**
 * Entry: read Excel → build user list → attach message sequences → send (or dry-run).
 * Usage: node index.js [--dry-run]
 */
const pool = require('./src/mysql');
const config = require('./config');
const { readExcel } = require('./src/excel');
const { buildSequence } = require('./src/messages');
const { sendAllUsers } = require('./src/send');
const { resolveGreenApiConfig } = require('./src/greenInstance');

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  // 1. Read Excel and build structured user list (normalized phones, sorted, deduped)
  let users;
  try {
    users = await readExcel(config.excelPath, config.defaultCountryCode);
  } catch (err) {
    console.error('Excel read failed:', err.message);
    process.exit(1);
  }

  if (!users.length) {
    console.log('No users found in Excel. Exiting.');
    return;
  }

  // 2. Attach messages 1–6 per user
  users.forEach((u) => {
    u.sequence = buildSequence(u, config.messageTemplates);
  });

  if (isDryRun) {
    console.log('--- DRY RUN: no messages sent ---');
    console.log(`Users: ${users.length}`);
    users.forEach((u, i) => {
      console.log(`  ${i + 1}. ${u.phone} | ${u.university} | ${u.city}`);
      u.sequence.forEach((msg, j) => {
        const preview = msg.length > 60 ? msg.slice(0, 57) + '...' : msg;
        console.log(`      [${j + 1}] ${preview}`);
      });
    });
    return;
  }

  // 3. Send all users via GreenAPI with delays (first Green instance in DB)
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM green_instances ORDER BY createdAt ASC LIMIT 1',
    );
    const row = rows[0];
    if (!row) {
      console.error('No GreenInstance in database. Add one in Settings (dashboard).');
      process.exit(1);
    }
    const greenApi = resolveGreenApiConfig(row);
    await sendAllUsers(users, {
      greenApi,
      delays: config.delays,
      messageTemplates: config.messageTemplates,
    });
    console.log('Send run finished.');
  } catch (err) {
    console.error('Send run failed:', err.message);
    process.exit(1);
  }
}

main().finally(() => pool.end().catch(() => {}));
