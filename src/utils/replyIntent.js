/**
 * Reply-intent matching rules for Message 1's other two Quick Reply buttons (opt-out lives in
 * ./optOut.js). Same dual approach: match an exact developer-set payload if the template editor
 * allows one, or fall back to matching the button's own display text / free-text keywords.
 */

const INTERESTED_BUTTON_PAYLOAD = 'YES_INTERESTED';
const DIFFERENT_UNI_BUTTON_PAYLOAD = 'DIFFERENT_UNI';

const INTERESTED_KEYWORDS = /\b(yes|yeah|yep|sure|interested)\b/i;
const DIFFERENT_UNI_KEYWORDS = /\b(different|other|another)\s*(uni|university)\b/i;
const NOT_INTERESTED_KEYWORDS = /\b(no|not\s*interested|nah|nope)\b/i;

/**
 * @param {{ messageType: 'text'|'button', buttonId?: string|null, buttonTitle?: string|null, bodyText?: string|null }} message
 * @returns {'interested'|'different_uni'|'not_interested'|'unrecognized'}
 */
function classifyReplyIntent({ messageType, buttonId, buttonTitle, bodyText }) {
  const buttonText = [buttonId, buttonTitle].filter(Boolean).join(' ');
  const text = messageType === 'button' ? buttonText : bodyText || '';

  if (messageType === 'button' && buttonId === DIFFERENT_UNI_BUTTON_PAYLOAD) return 'different_uni';
  if (messageType === 'button' && buttonId === INTERESTED_BUTTON_PAYLOAD) return 'interested';

  if (DIFFERENT_UNI_KEYWORDS.test(text)) return 'different_uni';
  if (NOT_INTERESTED_KEYWORDS.test(text)) return 'not_interested';
  if (INTERESTED_KEYWORDS.test(text)) return 'interested';

  return 'unrecognized';
}

module.exports = {
  INTERESTED_BUTTON_PAYLOAD,
  DIFFERENT_UNI_BUTTON_PAYLOAD,
  INTERESTED_KEYWORDS,
  DIFFERENT_UNI_KEYWORDS,
  NOT_INTERESTED_KEYWORDS,
  classifyReplyIntent,
};
