/**
 * DB access for inbound_messages — raw log of inbound Meta webhook messages, and best-effort
 * lookup of which campaign contact a reply belongs to.
 */
const pool = require('../mysql');

/**
 * @param {{ metaMessageId?: string, fromPhone: string, campaignId?: string|null,
 *   messageType: 'text'|'button', bodyText?: string|null, buttonId?: string|null,
 *   buttonTitle?: string|null }} params
 * @returns {Promise<number>} affected rows (0 if this meta_message_id was already logged)
 */
async function logInboundMessage({
  metaMessageId,
  fromPhone,
  campaignId = null,
  messageType,
  bodyText = null,
  buttonId = null,
  buttonTitle = null,
}) {
  const [result] = await pool.execute(
    `INSERT IGNORE INTO inbound_messages
      (meta_message_id, from_phone, campaign_id, message_type, body_text, button_id, button_title)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      metaMessageId != null ? String(metaMessageId) : null,
      String(fromPhone || '').trim(),
      campaignId != null ? String(campaignId) : null,
      messageType === 'button' ? 'button' : 'text',
      bodyText != null ? String(bodyText).slice(0, 65535) : null,
      buttonId != null ? String(buttonId).slice(0, 255) : null,
      buttonTitle != null ? String(buttonTitle).slice(0, 255) : null,
    ],
  );
  return Number(result.affectedRows) || 0;
}

/**
 * Best-effort match: the most recently-inserted campaign_contacts row for this phone,
 * used to associate an inbound reply with the campaign that likely triggered it.
 * @param {string} phoneNormalized
 * @returns {Promise<{ id: number, campaignId: string, payloadJson: string } | null>}
 */
async function findRecentCampaignContactByPhone(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return null;
  const [rows] = await pool.execute(
    `SELECT id, campaign_id, payload_json
     FROM campaign_contacts
     WHERE phone_normalized = ?
     ORDER BY id DESC
     LIMIT 1`,
    [phone],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, campaignId: row.campaign_id, payloadJson: row.payload_json };
}

module.exports = { logInboundMessage, findRecentCampaignContactByPhone };
