/**
 * One-shot: add failed_count / skipped_count to campaigns if missing; optional legacy backfill.
 * Safe to re-run (skips existing columns).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/mysql');

async function columnNames() {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns'`,
  );
  return new Set(rows.map((r) => r.name));
}

async function main() {
  const before = await columnNames();
  const hasLegacy = before.has('failed_or_skipped_count');
  const hadFailed = before.has('failed_count');
  const hadSkipped = before.has('skipped_count');
  const hadScheduledAt = before.has('scheduled_at');

  console.log('--- Before ---');
  console.log(
    'failed_count:',
    hadFailed,
    'skipped_count:',
    hadSkipped,
    'scheduled_at:',
    hadScheduledAt,
    'failed_or_skipped_count:',
    hasLegacy,
  );

  if (!hadFailed) {
    await pool.execute(
      'ALTER TABLE campaigns ADD COLUMN failed_count INT NOT NULL DEFAULT 0',
    );
    console.log('EXECUTED: ADD failed_count');
  }
  if (!hadSkipped) {
    await pool.execute(
      'ALTER TABLE campaigns ADD COLUMN skipped_count INT NOT NULL DEFAULT 0',
    );
    console.log('EXECUTED: ADD skipped_count');
  }
  if (!hadScheduledAt) {
    await pool.execute('ALTER TABLE campaigns ADD COLUMN scheduled_at TIMESTAMP NULL DEFAULT NULL');
    console.log('EXECUTED: ADD scheduled_at');
  }

  if (hasLegacy) {
    const [res] = await pool.execute(
      `UPDATE campaigns
       SET failed_count = failed_or_skipped_count
       WHERE failed_count = 0 AND (failed_or_skipped_count IS NOT NULL AND failed_or_skipped_count <> 0)`,
    );
    console.log('Backfill rows affected:', res.affectedRows ?? res);
  }

  const [desc] = await pool.query('DESCRIBE campaigns');
  console.log('--- DESCRIBE campaigns (after) ---');
  console.table(desc.map((r) => ({ Field: r.Field, Type: r.Type, Null: r.Null, Default: r.Default })));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
