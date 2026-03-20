/**
 * Shared Green API webhook processing: parse notification, route test vs prod reply flow.
 * @param {Buffer} rawBuffer
 * @param {string} greenInstanceDbId - Prisma GreenInstance.id
 */
const prisma = require('./db');
const { parseIncomingNotification } = require('./receive');
const { onIncomingReply, onIncomingReplyTest } = require('./replyFlow');
const { resolveGreenApiConfig } = require('./greenInstance');
const state = require('./state');
const testState = require('./testState');

async function processGreenApiWebhook(rawBuffer, greenInstanceDbId) {
  console.log('[Webhook] Instance:', greenInstanceDbId);

  const row = await prisma.greenInstance.findUnique({ where: { id: greenInstanceDbId } });
  if (!row) {
    console.error('[Webhook] Unknown greenInstanceDbId:', greenInstanceDbId);
    return;
  }
  const greenApi = resolveGreenApiConfig(row);

  let body = null;
  if (Buffer.isBuffer(rawBuffer) && rawBuffer.length > 0) {
    try {
      body = JSON.parse(rawBuffer.toString('utf8'));
    } catch (e) {
      console.error('[Webhook] Failed to parse raw body');
      return;
    }
  }
  if (!body || typeof body !== 'object') {
    console.log('[Webhook] Body keys: (empty or invalid)');
    return;
  }
  console.log('[Webhook] Raw body:', JSON.stringify(body).slice(0, 300));
  console.log('[Webhook] Body keys:', Object.keys(body).join(', '));
  const parsed = parseIncomingNotification(body);
  if (!parsed || !parsed.phone) {
    console.log('[Webhook] Ignored notification (unparsed or no phone)');
    console.log('[Webhook] Payload preview:', JSON.stringify(body).slice(0, 200));
    return;
  }
  console.log('[Webhook] Parsed phone:', parsed.phone);
  const norm = String(parsed.phone || '').replace(/\D/g, '');
  const keyVariants = [...new Set([norm, norm.replace(/^0+/, '')].filter((k) => k && k.length > 0))];
  let hasTest = false;
  let hasProd = false;
  for (const key of keyVariants) {
    if (testState.getState(greenInstanceDbId, key)) hasTest = true;
    if (state.getState(greenInstanceDbId, key)) hasProd = true;
  }
  console.log('[Webhook] Test state exists:', hasTest);
  console.log('[Webhook] Prod state exists:', hasProd);
  if (!hasTest && !hasProd) {
    console.log(
      '[Webhook] No matching test or prod state for this instance/phone; reply automation will not send (wrong instance id or phone mismatch?).',
    );
  }
  console.log('[Webhook] Comparing instanceId with state keys');
  console.log('[Webhook] Prod state keys:', Object.keys(state.loadState()));
  console.log('[Webhook] Test state keys:', Object.keys(testState.loadState()));
  if (hasTest) {
    await onIncomingReplyTest(parsed.phone, { greenApi, greenInstanceDbId });
  } else if (hasProd) {
    await onIncomingReply(parsed.phone, { greenApi, greenInstanceDbId });
  }
}

/**
 * Map Green API webhook JSON to Prisma GreenInstance.id using instanceData.idInstance.
 * @param {object|null} body - parsed top-level webhook body
 * @returns {Promise<string|null>}
 */
async function resolvePrismaIdFromWebhookBody(body) {
  if (!body || typeof body !== 'object') return null;
  const payload = body.body || body;
  const idInstance = payload?.instanceData?.idInstance;
  if (idInstance == null) return null;
  const row = await prisma.greenInstance.findFirst({
    where: { greenInstanceId: String(idInstance) },
  });
  return row ? row.id : null;
}

module.exports = { processGreenApiWebhook, resolvePrismaIdFromWebhookBody };
