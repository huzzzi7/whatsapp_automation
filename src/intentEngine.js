/**
 * Rule-based intent detection for inbound replies (optional AI can wrap this later).
 * NOT_INTERESTED uses strict phrases / word boundaries only — UNKNOWN never sets stopSequence.
 */

function detectIntent(text) {
  const msg = (text || '').toLowerCase().trim();

  // High-confidence opt-out only (compliance). No bare /no/ substring on whole message.
  const notInterested =
    /\bnot interested\b/i.test(msg) ||
    /\bdon't want\b/i.test(msg) ||
    /\bdont want\b/i.test(msg) ||
    /^no\s*$/i.test(msg) ||
    /\bno thanks\b/i.test(msg) ||
    /\bno thank you\b/i.test(msg) ||
    /\bunsubscribe\b/i.test(msg) ||
    /\bstop\b/i.test(msg) ||
    /\bremove me\b/i.test(msg);

  if (notInterested) {
    return {
      type: 'NOT_INTERESTED',
      reply: 'No worries xx.',
      stopSequence: true,
    };
  }

  if (/\b(salary|price|kitna|paisa|income|pay)\b/i.test(msg)) {
    return {
      type: 'PRICE',
      reply: null,
      stopSequence: false,
    };
  }

  if (/\b(where|location|country|kahan)\b/i.test(msg)) {
    return {
      type: 'LOCATION',
      reply: null,
      stopSequence: false,
    };
  }

  if (
    /\b(yes|yeah|yep|sure|ok|alright|interested|go on|go ahead|show me|come on|why not)\b/i.test(msg) ||
    /\btell me\b/i.test(msg) ||
    /\bdetails\b/i.test(msg) ||
    /\bwhat is it\b/i.test(msg) ||
    /\bsounds good\b/i.test(msg)
  ) {
    return {
      type: 'INTERESTED',
      reply: null,
      stopSequence: false,
    };
  }

  return {
    type: 'UNKNOWN',
    reply: null,
    stopSequence: false,
  };
}

module.exports = { detectIntent };
