/**
 * Idempotent log of processed inbound webhook messages (Green API retries / duplicates).
 */
const pool = require('../mysql');

/**
 * @param {{
 *   greenInstanceDbId: string,
 *   providerMessageId: string,
 *   typeWebhook: string,
 *   phone?: string|null,
 *   dedupeKey: string,
 * }} params
 * @returns {Promise<{ inserted: boolean }>}
 */
async function insertIncomingMessage({ greenInstanceDbId, providerMessageId, typeWebhook, phone, dedupeKey }) {
  try {
    await pool.execute(
      `INSERT INTO incoming_messages_log (
        green_instance_db_id,
        provider_message_id,
        type_webhook,
        phone_normalized,
        dedupe_key,
        received_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [
        String(greenInstanceDbId || '').trim(),
        String(providerMessageId || '').trim(),
        String(typeWebhook || '').trim(),
        phone != null && String(phone).trim() !== '' ? String(phone).trim() : null,
        String(dedupeKey || '').trim(),
      ],
    );
    return { inserted: true };
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      return { inserted: false };
    }
    throw err;
  }
}

module.exports = { insertIncomingMessage };
