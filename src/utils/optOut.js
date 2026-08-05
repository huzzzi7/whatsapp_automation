/**
 * Shared opt-out matching rules — used by both the inbound webhook processor (to detect an
 * opt-out reply) and the template verification check (to confirm a template's button qualifies).
 */

/** Exact button payload some template editors let you set explicitly. */
const OPT_OUT_BUTTON_PAYLOAD = 'OPT_OUT';

/** Free-text / button-display-text fallback match. */
const OPT_OUT_KEYWORDS = /\b(stop|unsubscribe|opt[\s-]?out|remove\s*me)\b/i;

/**
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
function isOptOutText(text) {
  return text != null && OPT_OUT_KEYWORDS.test(String(text));
}

module.exports = { OPT_OUT_BUTTON_PAYLOAD, OPT_OUT_KEYWORDS, isOptOutText };
