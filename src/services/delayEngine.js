/**
 * Phase 2.1 — centralized delay policy.
 * Wired into controlledSend.js — applies per-message delay and skip logic.
 * Computes recommended wait time and optional skip for a single outbound step.
 */

/**
 * @param {object} params
 * @param {number} [params.minDelay]
 * @param {number} [params.maxDelay]
 * @param {number} params.messageIndex
 * @param {number|null|undefined} params.lastMessageAt - epoch ms of last outbound; omit if unknown
 * @param {string} [params.context] - e.g. "reply" | "intent" | "campaign"
 * @returns {{ delayMs: number, shouldSkip: boolean }}
 */
function delayEngine({ minDelay, maxDelay, messageIndex, lastMessageAt, context }) {
  const idx = Math.floor(Number(messageIndex) || 0);
  const ctx = context != null ? String(context).trim().toLowerCase() : '';

  let min = Math.floor(Number(minDelay));
  let max = Math.floor(Number(maxDelay));
  if (!Number.isFinite(min) || min < 0) min = 1000;
  if (!Number.isFinite(max) || max < min) max = Math.max(min, 5000);

  /** Uniform random integer in [a, b] inclusive. */
  function randInt(a, b) {
    const lo = Math.ceil(Math.min(a, b));
    const hi = Math.floor(Math.max(a, b));
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  // 1) Base delay between minDelay and maxDelay
  let delayMs = randInt(min, max);

  // 2) Jitter: +0..3000 ms
  delayMs += randInt(0, 3000);

  // 3) Human pause: after every 3–5 messages (random threshold per call), +30s–120s
  if (idx > 0) {
    const threshold = randInt(3, 5);
    if (idx % threshold === 0) {
      delayMs += randInt(30_000, 120_000);
    }
  }

  // 4) Cooldown awareness: if last send was < 120s ago, add extra delay (do not skip)
  const last = lastMessageAt != null ? Number(lastMessageAt) : NaN;
  if (Number.isFinite(last)) {
    const elapsed = Date.now() - last;
    if (elapsed >= 0 && elapsed < 120_000) {
      delayMs += randInt(10_000, 30_000);
    }
  }

  let shouldSkip = false;

  return { delayMs, shouldSkip };
}

module.exports = { delayEngine };

if (require.main === module) {
  const { delayEngine: de } = module.exports;
  console.log('--- delayEngine self-test (20 runs) ---\n');
  const skips = { true: 0, false: 0 };
  const delays = [];

  for (let i = 0; i < 20; i += 1) {
    const messageIndex = i % 11;
    const lastMessageAt = Date.now() - Math.floor(Math.random() * 180_000);
    const r = de({
      minDelay: 2000,
      maxDelay: 8000,
      messageIndex,
      lastMessageAt,
      context: 'reply',
    });
    skips[String(r.shouldSkip)] = (skips[String(r.shouldSkip)] || 0) + 1;
    delays.push(r.delayMs);

    console.log(
      `run ${String(i + 1).padStart(2)} | idx=${messageIndex} | delayMs=${r.delayMs} | shouldSkip=${r.shouldSkip}`,
    );
  }

  console.log('\n--- distribution ---');
  console.log('shouldSkip true:', skips.true || 0, '| false:', skips.false || 0);
  console.log('delayMs min:', Math.min(...delays), '| max:', Math.max(...delays));

  console.log('\nVerify idx=0 and intent never skip:');
  const z = de({ minDelay: 1000, maxDelay: 2000, messageIndex: 0, lastMessageAt: Date.now() - 5000, context: 'reply' });
  console.log('  idx=0:', z);
  const intent = de({ minDelay: 1000, maxDelay: 2000, messageIndex: 5, lastMessageAt: Date.now() - 5000, context: 'intent' });
  console.log('  context=intent idx=5:', intent);
}
