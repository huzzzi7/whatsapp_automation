/**
 * Best-effort lookup of which campaign contact an inbound reply belongs to. (Historical note:
 * this module used to also log inbound messages into a now-retired inbound_messages table —
 * that responsibility moved to conversationRepository, which captures both directions.)
 */
const pool = require('../mysql');

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

module.exports = { findRecentCampaignContactByPhone };
