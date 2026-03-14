/**
 * Parse GreenAPI incoming notifications (webhook or polling payload).
 * Only processes incomingMessageReceived; ignores status and outgoing.
 */
function parseIncomingNotification(body) {
  if (!body || typeof body !== 'object') return null;
  const payload = body.body || body;
  if (payload.typeWebhook !== 'incomingMessageReceived') {
    console.log('[Webhook] Ignored webhook type:', payload.typeWebhook);
    return null;
  }

  const senderData = payload.senderData;
  if (!senderData || !senderData.chatId) return null;

  const rawChatId = String(senderData.chatId).trim();
  console.log('[Webhook] chatId received:', rawChatId);
  const phone = rawChatId.replace(/@c\.us$/i, '').replace(/\D/g, '');
  if (!phone) return null;
  const chatId = phone + '@c.us';

  let text = '';
  const messageData = payload.messageData || {};
  if (messageData.typeMessage === 'textMessage' && messageData.textMessageData) {
    text = messageData.textMessageData.textMessage || '';
  }

  return { phone, chatId, text };
}

module.exports = { parseIncomingNotification };
