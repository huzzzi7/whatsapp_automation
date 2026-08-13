/**
 * DB access for conversations + conversation_messages — the unified, bidirectional message
 * thread per phone number backing the admin chat/inbox feature. Replaces inbound_messages'
 * former role (that table only ever captured the inbound side).
 */
const pool = require('../mysql');

function mapMessageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    phoneNormalized: row.phone_normalized,
    campaignId: row.campaign_id,
    direction: row.direction,
    sender: row.sender,
    metaMessageId: row.meta_message_id,
    messageType: row.message_type,
    bodyText: row.body_text,
    buttonId: row.button_id,
    buttonTitle: row.button_title,
    mediaPath: row.media_path,
    mediaMimeType: row.media_mime_type,
    mediaFilename: row.media_filename,
    mediaCaption: row.media_caption,
    reactionEmoji: row.reaction_emoji,
    reactionTargetMessageId: row.reaction_target_message_id,
    adminUserId: row.admin_user_id,
    sendError: row.send_error,
    createdAt: row.created_at,
  };
}

function previewFromMessage({ messageType, bodyText, mediaFilename, reactionEmoji, buttonTitle }) {
  if (messageType === 'reaction') return `Reacted ${reactionEmoji || ''}`;
  if (['image', 'document', 'video', 'audio'].includes(messageType)) {
    return mediaFilename ? `📎 ${mediaFilename}` : `📎 ${messageType}`;
  }
  if (messageType === 'button') return buttonTitle || bodyText || '';
  return bodyText != null ? String(bodyText).slice(0, 200) : '';
}

/**
 * @param {{ phoneNormalized: string, campaignId?: string|null, direction: 'inbound'|'outbound',
 *   sender: 'customer'|'system'|'admin', metaMessageId?: string|null, messageType: string,
 *   bodyText?: string|null, buttonId?: string|null, buttonTitle?: string|null,
 *   mediaPath?: string|null, mediaMimeType?: string|null, mediaFilename?: string|null,
 *   mediaCaption?: string|null, reactionEmoji?: string|null, reactionTargetMessageId?: string|null,
 *   adminUserId?: string|null, sendError?: string|null, displayName?: string|null }} params
 * @returns {Promise<number>} affected rows (0 if this meta_message_id was already logged — webhook retry)
 */
async function logMessage(params) {
  const {
    phoneNormalized,
    campaignId = null,
    direction,
    sender,
    metaMessageId = null,
    messageType,
    bodyText = null,
    buttonId = null,
    buttonTitle = null,
    mediaPath = null,
    mediaMimeType = null,
    mediaFilename = null,
    mediaCaption = null,
    reactionEmoji = null,
    reactionTargetMessageId = null,
    adminUserId = null,
    sendError = null,
    displayName = null,
  } = params;

  const phone = String(phoneNormalized || '').trim();
  if (!phone) return 0;

  const [result] = await pool.execute(
    `INSERT IGNORE INTO conversation_messages
      (phone_normalized, campaign_id, direction, sender, meta_message_id, message_type,
       body_text, button_id, button_title, media_path, media_mime_type, media_filename,
       media_caption, reaction_emoji, reaction_target_message_id, admin_user_id, send_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      phone,
      campaignId,
      direction,
      sender,
      metaMessageId,
      messageType,
      bodyText,
      buttonId,
      buttonTitle,
      mediaPath,
      mediaMimeType,
      mediaFilename,
      mediaCaption,
      reactionEmoji,
      reactionTargetMessageId,
      adminUserId,
      sendError,
    ],
  );
  const affected = Number(result.affectedRows) || 0;
  if (affected === 0) return 0;

  const preview = previewFromMessage({ messageType, bodyText, mediaFilename, reactionEmoji, buttonTitle });
  await pool.execute(
    `INSERT INTO conversations (phone_normalized, display_name, last_message_at, last_message_preview, last_campaign_id)
     VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = COALESCE(?, display_name),
       last_message_at = CURRENT_TIMESTAMP,
       last_message_preview = ?,
       last_campaign_id = COALESCE(?, last_campaign_id)`,
    [phone, displayName, preview, campaignId, displayName, preview, campaignId],
  );
  return affected;
}

/**
 * @param {string} phoneNormalized
 * @returns {Promise<{ confirmedInterest: boolean, confirmedUniversity: string|null, leadQualified: boolean }|null>}
 */
async function getConversationByPhone(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return null;
  const [rows] = await pool.execute(
    'SELECT confirmed_interest, confirmed_university, lead_qualified FROM conversations WHERE phone_normalized = ? LIMIT 1',
    [phone],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    confirmedInterest: Boolean(row.confirmed_interest),
    confirmedUniversity: row.confirmed_university,
    leadQualified: Boolean(row.lead_qualified),
  };
}

async function markConversationSeen(phoneNormalized) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return;
  await pool.execute(
    'UPDATE conversations SET last_seen_by_admin_at = CURRENT_TIMESTAMP WHERE phone_normalized = ?',
    [phone],
  );
}

/**
 * A lead is qualified once both interest and their university have ever been confirmed by the
 * AI reply service — persisted separately so a signal from an earlier message still counts once
 * the other one arrives later. Idempotent and one-directional: never un-qualifies a conversation
 * that already reached that state.
 * @param {string} phoneNormalized
 * @param {{ confirmedInterest?: boolean, confirmedUniversity?: string|null }} signals
 */
async function applyLeadSignals(phoneNormalized, { confirmedInterest, confirmedUniversity }) {
  const phone = String(phoneNormalized || '').trim();
  if (!phone) return;
  if (!confirmedInterest && !confirmedUniversity) return;

  const interestFlag = confirmedInterest ? 1 : 0;
  const university = confirmedUniversity || null;

  await pool.execute(
    `UPDATE conversations
     SET confirmed_interest = GREATEST(confirmed_interest, ?),
         confirmed_university = COALESCE(?, confirmed_university),
         lead_qualified = CASE
           WHEN GREATEST(confirmed_interest, ?) = 1 AND COALESCE(?, confirmed_university) IS NOT NULL THEN 1
           ELSE lead_qualified
         END,
         qualified_at = CASE
           WHEN lead_qualified = 0
             AND GREATEST(confirmed_interest, ?) = 1
             AND COALESCE(?, confirmed_university) IS NOT NULL
             THEN CURRENT_TIMESTAMP
           ELSE qualified_at
         END
     WHERE phone_normalized = ?`,
    [interestFlag, university, interestFlag, university, interestFlag, university, phone],
  );
}

/**
 * @param {{ campaignId?: string|null, deliveryStatus?: string|null, repliedOnly?: boolean, qualifiedOnly?: boolean, page?: number, limit?: number }} opts
 */
async function listConversations({ campaignId, deliveryStatus, repliedOnly, qualifiedOnly, page = 1, limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const pg = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (pg - 1) * lim;

  const where = [];
  const params = [];

  if (campaignId) {
    where.push('c.last_campaign_id = ?');
    params.push(campaignId);
  }
  if (repliedOnly) {
    // At least one inbound message ever, regardless of what happened after (opted out, normal
    // conversation, etc.) — an opt-out itself is logged as an inbound message (button tap or
    // keyword), so someone who unsubscribed still counts as "replied".
    where.push(
      `EXISTS (SELECT 1 FROM conversation_messages cm WHERE cm.phone_normalized = c.phone_normalized AND cm.direction = 'inbound')`,
    );
  }
  if (qualifiedOnly) {
    where.push('c.lead_qualified = 1');
  }
  if (deliveryStatus) {
    where.push('cc.meta_delivery_status = ?');
    params.push(deliveryStatus);
  } else {
    // Default ("All") view: hide contacts whose only send attempt failed — a conversation row is
    // created optimistically when Meta *accepts* a template send, but the real failure (recipient
    // not reachable, etc.) only arrives later via webhook and would otherwise leave a dead thread
    // sitting in the list forever. Explicitly filtering to 'failed' still shows them.
    where.push("(cc.meta_delivery_status IS NULL OR cc.meta_delivery_status != 'failed')");
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.execute(
    `SELECT c.*, cc.meta_delivery_status, cmp.name AS campaign_name,
            (c.last_seen_by_admin_at IS NULL OR c.last_seen_by_admin_at < c.last_message_at) AS is_unseen
     FROM conversations c
     LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.last_campaign_id AND cc.phone_normalized = c.phone_normalized
     LEFT JOIN campaigns cmp ON cmp.id = c.last_campaign_id
     ${whereSql}
     ORDER BY c.last_message_at DESC
     LIMIT ${lim} OFFSET ${offset}`,
    params,
  );

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS cnt
     FROM conversations c
     LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.last_campaign_id AND cc.phone_normalized = c.phone_normalized
     ${whereSql}`,
    params,
  );

  return {
    total: Number(countRows[0]?.cnt) || 0,
    conversations: rows.map((r) => ({
      phoneNormalized: r.phone_normalized,
      displayName: r.display_name,
      lastMessageAt: r.last_message_at,
      lastMessagePreview: r.last_message_preview,
      lastCampaignId: r.last_campaign_id,
      campaignName: r.campaign_name,
      metaDeliveryStatus: r.meta_delivery_status,
      isUnseen: Boolean(r.is_unseen),
      leadQualified: Boolean(r.lead_qualified),
      confirmedUniversity: r.confirmed_university,
    })),
  };
}

/**
 * @param {string} phoneNormalized
 * @param {{ page?: number, limit?: number }} opts
 * @returns {Promise<object[]>} oldest-first (ready to render top-to-bottom)
 */
async function getConversationMessages(phoneNormalized, { page = 1, limit = 100 } = {}) {
  const phone = String(phoneNormalized || '').trim();
  const lim = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const pg = Math.max(1, Math.floor(Number(page) || 1));
  const offset = (pg - 1) * lim;
  const [rows] = await pool.execute(
    `SELECT * FROM conversation_messages
     WHERE phone_normalized = ?
     ORDER BY id DESC
     LIMIT ${lim} OFFSET ${offset}`,
    [phone],
  );
  return rows.map(mapMessageRow).reverse();
}

/**
 * Reply counts + last-reply preview per contact, for the campaign contacts modal.
 * @param {string} campaignId
 * @returns {Promise<Map<string, { count: number, lastReplyAt: Date|null, lastReplyPreview: string }>>} keyed by phone_normalized
 */
async function getReplyCountsByCampaign(campaignId) {
  const map = new Map();
  const cid = String(campaignId || '').trim();
  if (!cid) return map;
  const [rows] = await pool.execute(
    `SELECT cm.phone_normalized, cm.body_text, cm.message_type, cm.button_title,
            cm.reaction_emoji, cm.media_filename, cm.created_at, agg.cnt
     FROM conversation_messages cm
     INNER JOIN (
       SELECT phone_normalized, COUNT(*) AS cnt, MAX(id) AS max_id
       FROM conversation_messages
       WHERE campaign_id = ? AND direction = 'inbound'
       GROUP BY phone_normalized
     ) agg ON agg.max_id = cm.id`,
    [cid],
  );
  for (const r of rows || []) {
    map.set(String(r.phone_normalized), {
      count: Number(r.cnt) || 0,
      lastReplyAt: r.created_at,
      lastReplyPreview: previewFromMessage({
        messageType: r.message_type,
        bodyText: r.body_text,
        mediaFilename: r.media_filename,
        reactionEmoji: r.reaction_emoji,
        buttonTitle: r.button_title,
      }),
    });
  }
  return map;
}

module.exports = {
  logMessage,
  markConversationSeen,
  applyLeadSignals,
  getConversationByPhone,
  listConversations,
  getConversationMessages,
  getReplyCountsByCampaign,
};
