#!/usr/bin/env node
/**
 * Phase 5 — Seed warmup_templates table.
 * Safe to re-run: uses INSERT ... ON DUPLICATE KEY UPDATE on template_index.
 *
 * Usage:
 *   node scripts/seed-warmup-templates.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/mysql');
const { WARMUP_TEMPLATES } = require('./warmup-templates.data');

function normalizeRole(role) {
  const r = String(role || '').trim().toUpperCase();
  return r === 'B' ? 'B' : 'A';
}

function normalizeText(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
}

function validateTemplate(t) {
  const idx = Math.floor(Number(t?.template_index));
  const name = String(t?.template_name || '').trim();
  const messages = Array.isArray(t?.messages) ? t.messages : [];
  if (!Number.isFinite(idx) || idx < 1) throw new Error('template_index must be an integer >= 1');
  if (!name) throw new Error(`template_name missing for template_index=${idx}`);
  if (messages.length < 2) throw new Error(`messages must have at least 2 items for template_index=${idx}`);
  const normalized = messages
    .map((m) => ({ role: normalizeRole(m?.role), text: normalizeText(m?.text) }))
    .filter((m) => m.text.length > 0);
  if (normalized.length < 2) throw new Error(`messages normalize to <2 non-empty items for template_index=${idx}`);
  return { idx, name, normalized };
}

(async () => {
  if (!Array.isArray(WARMUP_TEMPLATES) || WARMUP_TEMPLATES.length === 0) {
    console.error(
      'No templates found. Paste your 30 templates into scripts/warmup-templates.data.js (WARMUP_TEMPLATES).',
    );
    process.exit(1);
  }

  let inserted = 0;
  for (const t of WARMUP_TEMPLATES) {
    const { idx, name, normalized } = validateTemplate(t);
    const messagesJson = JSON.stringify(normalized);
    await pool.execute(
      `INSERT INTO warmup_templates (template_index, template_name, messages_json, is_active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         template_name = VALUES(template_name),
         messages_json = VALUES(messages_json),
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP`,
      [idx, name, messagesJson],
    );
    inserted += 1;
  }

  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS cnt, SUM(is_active=1) AS activeCnt FROM warmup_templates',
  );
  console.log(`Seed complete. Upserted=${inserted}. Total=${rows[0]?.cnt || 0}, active=${rows[0]?.activeCnt || 0}`);
  await pool.end();
})().catch(async (e) => {
  console.error('Seed failed:', e?.message || e);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});

