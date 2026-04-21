/**
 * Unified outbound pipeline: behavior + delay engines, optional skip, wait, typing, then send.
 */
const { delayEngine } = require('./delayEngine');
const { behaviorEngine } = require('./behaviorEngine');
const { simulateTyping, sendMessage } = require('../greenapi');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

function sleepMs(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDelayBoundsMs() {
  const min = parseInt(process.env.MESSAGE_DELAY_MIN_MS || '10000', 10);
  const max = parseInt(process.env.MESSAGE_DELAY_MAX_MS || '60000', 10);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    return { minDelay: 10_000, maxDelay: 60_000 };
  }
  return { minDelay: min, maxDelay: max };
}

/**
 * @param {object} params
 * @param {string} params.instanceId
 * @param {string} params.apiToken
 * @param {string} params.baseUrl
 * @param {string} params.chatId
 * @param {string} params.message
 * @param {string} [params.context] - reply | intent | campaign
 * @param {number} [params.messageCount]
 * @param {number|null|undefined} params.lastMessageAt - epoch ms
 * @param {string} [params.campaignId] - stable campaign id for tracing (file logs)
 * @param {string} [params.phoneDigits]
 * @returns {Promise<{ skipped: true } | { sent: true, delay: number }>}
 */
async function controlledSend({
  instanceId,
  apiToken,
  baseUrl,
  chatId,
  message,
  context,
  messageCount,
  lastMessageAt,
  campaignId,
  phoneDigits,
}) {
  if (!instanceId || !apiToken || !baseUrl || !chatId) {
    throw new Error('controlledSend requires instanceId, apiToken, baseUrl, and chatId');
  }
  const text = message != null ? String(message) : '';
  if (!text.trim()) {
    throw new Error('controlledSend requires a non-empty message');
  }

  const ctx = context != null ? String(context).trim().toLowerCase() : 'reply';
  const countRaw = Math.floor(Number(messageCount));
  const safeCount = Number.isFinite(countRaw) && countRaw >= 0 ? countRaw : 0;

  const trace = { campaignId: campaignId || undefined, chatId, phoneDigits: phoneDigits || undefined };
  const child = log.child(trace);

  const behavior = behaviorEngine({
    messageCount: safeCount,
    lastMessageAt,
    context: ctx,
  });

  const { minDelay, maxDelay } = getDelayBoundsMs();
  const delay = delayEngine({
    minDelay,
    maxDelay,
    messageIndex: safeCount,
    lastMessageAt,
    context: ctx,
  });

  let finalDelay = delay.delayMs + behavior.extraDelay;
  const shouldSkip = Boolean(delay.shouldSkip || behavior.shouldSkip);

  if (String(process.env.DISABLE_DELAYS || '').toLowerCase() === 'true') {
    const lo = 3000;
    const hi = 7000;
    finalDelay = lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  if (shouldSkip) {
    child.info(
      { event: 'message_skipped_pipeline', context: ctx, messageCount: safeCount },
      'message_skipped_pipeline',
    );
    return { skipped: true };
  }

  child.debug(
    { event: 'send_delay_wait', finalDelayMs: finalDelay, context: ctx, messageCount: safeCount },
    'send_delay_wait',
  );
  await sleepMs(finalDelay);

  child.debug({ event: 'simulate_typing_start', context: ctx }, 'simulate_typing_start');
  await simulateTyping({
    instanceId,
    apiToken,
    baseUrl,
    chatId,
  });

  const greenApi = { instanceId, apiToken, baseUrl };
  await sendMessage(chatId, text, greenApi);

  child.info(
    {
      event: 'message_sent',
      delayMs: finalDelay,
      context: ctx,
      messageCount: safeCount,
    },
    'message_sent',
  );

  return { sent: true, delay: finalDelay };
}

module.exports = { controlledSend };

if (require.main === module) {
  const root = require('../utils/logger').root;
  root.info('--- controlledSend self-test: merge + skip (10 runs, no HTTP) ---');
  const ctxs = ['reply', 'intent', 'campaign'];
  let intentSkips = 0;
  let replySkips = 0;
  for (let i = 0; i < 10; i += 1) {
    const messageCount = i % 11;
    const context = ctxs[i % 3];
    const lastMessageAt = Date.now() - Math.floor(Math.random() * 60_000);
    const behavior = behaviorEngine({ messageCount, lastMessageAt, context });
    const { minDelay, maxDelay } = getDelayBoundsMs();
    const delay = delayEngine({
      minDelay,
      maxDelay,
      messageIndex: messageCount,
      lastMessageAt,
      context,
    });
    const finalDelay = delay.delayMs + behavior.extraDelay;
    const shouldSkip = Boolean(delay.shouldSkip || behavior.shouldSkip);
    if (context === 'intent' && shouldSkip) intentSkips += 1;
    if (context === 'reply' && shouldSkip) replySkips += 1;
    root.debug(
      {
        event: 'self_test_row',
        run: i + 1,
        context,
        messageCount,
        stage: behavior.stage,
        finalDelay,
        shouldSkip,
      },
      'self_test_row',
    );
  }
  root.info({ intentSkips, replySkips }, 'controlledSend self-test done');
}
