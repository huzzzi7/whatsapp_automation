/**
 * Reply-intent matching rules for Message 1's other two Quick Reply buttons (opt-out lives in
 * ./optOut.js). Same dual approach: match an exact developer-set payload if the template editor
 * allows one, or fall back to matching the button's own display text / free-text keywords.
 */

const INTERESTED_BUTTON_PAYLOAD = 'YES_INTERESTED';
const DIFFERENT_UNI_BUTTON_PAYLOAD = 'DIFFERENT_UNI';
const GET_GROUP_LINK_BUTTON_PAYLOAD = 'GET_GROUP_LINK';

const INTERESTED_KEYWORDS = /\b(yes|yeah|yep|sure|interested)\b/i;
const DIFFERENT_UNI_KEYWORDS = /\b(different|other|another)\s*(uni|university)\b/i;
const NOT_INTERESTED_KEYWORDS = /\b(no|not\s*interested|nah|nope)\b/i;
// Matches the "Get Group Link" quick-reply button some templates use to hand out the group link
// on request instead of embedding it in the template body.
const GET_GROUP_LINK_KEYWORDS = /\bgroup\s*link\b/i;

/**
 * @param {{ messageType: 'text'|'button', buttonId?: string|null, buttonTitle?: string|null, bodyText?: string|null }} message
 * @returns {'interested'|'different_uni'|'get_group_link'|'not_interested'|'unrecognized'}
 */
function classifyReplyIntent({ messageType, buttonId, buttonTitle, bodyText }) {
  const buttonText = [buttonId, buttonTitle].filter(Boolean).join(' ');
  const text = messageType === 'button' ? buttonText : bodyText || '';

  if (messageType === 'button' && buttonId === DIFFERENT_UNI_BUTTON_PAYLOAD) return 'different_uni';
  if (messageType === 'button' && buttonId === INTERESTED_BUTTON_PAYLOAD) return 'interested';
  if (messageType === 'button' && buttonId === GET_GROUP_LINK_BUTTON_PAYLOAD) return 'get_group_link';

  if (DIFFERENT_UNI_KEYWORDS.test(text)) return 'different_uni';
  if (GET_GROUP_LINK_KEYWORDS.test(text)) return 'get_group_link';
  if (NOT_INTERESTED_KEYWORDS.test(text)) return 'not_interested';
  if (INTERESTED_KEYWORDS.test(text)) return 'interested';

  return 'unrecognized';
}

module.exports = {
  INTERESTED_BUTTON_PAYLOAD,
  DIFFERENT_UNI_BUTTON_PAYLOAD,
  GET_GROUP_LINK_BUTTON_PAYLOAD,
  INTERESTED_KEYWORDS,
  DIFFERENT_UNI_KEYWORDS,
  NOT_INTERESTED_KEYWORDS,
  GET_GROUP_LINK_KEYWORDS,
  classifyReplyIntent,
};
