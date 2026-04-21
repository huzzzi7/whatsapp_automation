/**
 * Phase 2.3 — human behavior policy.
 * Wired into controlledSend.js — applies stage-based skip probability
 * and extra delay based on message count context.
 */

/** Uniform random integer in [a, b] inclusive (milliseconds when used for delays). */
function randInt(a, b) {
  const lo = Math.ceil(Math.min(a, b));
  const hi = Math.floor(Math.max(a, b));
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/**
 * @param {object} params
 * @param {number} [params.messageCount]
 * @param {number|null|undefined} params.lastMessageAt - epoch ms of last outbound; omit if unknown
 * @param {string} [params.context] - e.g. "reply" | "intent"
 * @returns {{ extraDelay: number, shouldSkip: boolean, stage: 'fast' | 'normal' | 'slow' }}
 */
function behaviorEngine({ messageCount, lastMessageAt, context }) {
  const count = Math.floor(Number(messageCount));
  const n = Number.isFinite(count) && count >= 0 ? count : 0;
  const ctx = context != null ? String(context).trim().toLowerCase() : '';

  let stage;
  if (n <= 2) {
    stage = 'fast';
  } else if (n >= 3 && n <= 5) {
    stage = 'normal';
  } else {
    stage = 'slow';
  }

  let extraDelay = 0;
  let shouldSkip = false;

  if (stage === 'fast') {
    shouldSkip = false;
  } else if (stage === 'normal') {
    // NOTE: if this skips, lastSentIndex may already be advanced (replyFlow enqueue)
    // meaning this sequence slot will be permanently lost for this user.
    // Consider changing to delay-only (no skip) if slot loss is unacceptable.
    shouldSkip = Math.random() < 0.05;
  } else {
    // NOTE: if this skips, lastSentIndex may already be advanced (replyFlow enqueue)
    // meaning this sequence slot will be permanently lost for this user.
    // Consider changing to delay-only (no skip) if slot loss is unacceptable.
    shouldSkip = Math.random() < 0.15;
    if (Math.random() < 0.2) {
      extraDelay += randInt(30_000, 90_000);
    }
  }

  const last = lastMessageAt != null ? Number(lastMessageAt) : NaN;
  if (Number.isFinite(last)) {
    const elapsed = Date.now() - last;
    if (elapsed >= 0 && elapsed < 30_000 && Math.random() < 0.3) {
      extraDelay += randInt(10_000, 30_000);
    }
  }

  if (ctx === 'intent') {
    shouldSkip = false;
  }

  return { extraDelay, shouldSkip, stage };
}

module.exports = { behaviorEngine };

if (require.main === module) {
  const { behaviorEngine: be } = module.exports;
  console.log('--- behaviorEngine self-test (20 runs, messageCount 0–10, reply) ---\n');

  const byStage = { fast: 0, normal: 0, slow: 0 };
  const skipsByStage = { fast: { t: 0, f: 0 }, normal: { t: 0, f: 0 }, slow: { t: 0, f: 0 } };
  const slowWithLongPause = [];

  for (let i = 0; i < 20; i += 1) {
    const messageCount = i % 11;
    const lastMessageAt = Date.now() - Math.floor(Math.random() * 60_000);
    const r = be({ messageCount, lastMessageAt, context: 'reply' });
    byStage[r.stage] += 1;
    if (r.shouldSkip) skipsByStage[r.stage].t += 1;
    else skipsByStage[r.stage].f += 1;
    if (r.stage === 'slow' && r.extraDelay > 0) slowWithLongPause.push({ i: i + 1, extraDelay: r.extraDelay, messageCount });

    console.log(
      `run ${String(i + 1).padStart(2)} | messageCount=${messageCount} | stage=${r.stage} | extraDelay=${r.extraDelay} | shouldSkip=${r.shouldSkip}`,
    );
  }

  console.log('\n--- intent: shouldSkip must always be false ---');
  for (let k = 0; k < 5; k += 1) {
    const r = be({
      messageCount: 8,
      lastMessageAt: Date.now() - 5000,
      context: 'intent',
    });
    console.log(`intent run ${k + 1} | stage=${r.stage} | extraDelay=${r.extraDelay} | shouldSkip=${r.shouldSkip}`);
  }

  console.log('\n--- summary ---');
  console.log('runs per stage:', byStage);
  console.log('skip true/false by stage:', skipsByStage);
  console.log('slow runs with extraDelay>0 (long pause and/or silence window):', slowWithLongPause.length);
}
