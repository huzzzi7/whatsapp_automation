/**
 * Parse GreenAPI incoming notifications (webhook or polling payload).
 * Only processes incomingMessageReceived; ignores status and outgoing.
 */
const config = require('../config');
const { normalizePhone, toChatId } = require('./phone');

const INCOMING_TYPE = 'incomingMessageReceived';

function parseIncomingNotification(body) {
  if (!body || typeof body !== 'object') return null;
  const payload = body.body || body;

  if (payload.typeWebhook !== INCOMING_TYPE) {
    console.log('[Webhook] Ignored type:', payload.typeWebhook);
    return null;
  }

  if (!payload.senderData?.chatId) {
    console.log('[Webhook] Missing chatId');
    return null;
  }

  const rawChatId = String(payload.senderData.chatId).trim();
  console.log('[Webhook] Raw chatId:', rawChatId);

  const digits = rawChatId.replace(/@c\.us$/i, '').replace(/\D/g, '');
  const normalized = normalizePhone(digits, config.defaultCountryCode);
  if (!normalized) {
    console.log('[Webhook] Empty phone after normalize');
    return null;
  }

  let providerMessageId = null;
  if (payload.idMessage != null && String(payload.idMessage).trim() !== '') {
    providerMessageId = String(payload.idMessage).trim();
  } else if (payload.messageData?.idMessage != null && String(payload.messageData.idMessage).trim() !== '') {
    providerMessageId = String(payload.messageData.idMessage).trim();
  } else if (
    payload.messageData?.textMessageData?.idMessage != null &&
    String(payload.messageData.textMessageData.idMessage).trim() !== ''
  ) {
    providerMessageId = String(payload.messageData.textMessageData.idMessage).trim();
  }

  let text = '';
  const messageData = payload.messageData || {};
  if (messageData.typeMessage === 'textMessage' && messageData.textMessageData) {
    text = messageData.textMessageData.textMessage || '';
  }

  const rawTs = payload.timestamp;
  let timestamp = Number(rawTs);
  if (!Number.isFinite(timestamp)) {
    timestamp = Date.now();
  }

  return {
    phone: normalized,
    chatId: toChatId(normalized),
    text,
    providerMessageId,
    typeWebhook: INCOMING_TYPE,
    timestamp,
  };
}

module.exports = { parseIncomingNotification, INCOMING_TYPE };
