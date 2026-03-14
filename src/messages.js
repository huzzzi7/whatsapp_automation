/**
 * Build the 6-message sequence per user from templates.
 * Message 1 uses university; message 6 uses link (empty link => empty string for msg 6).
 */
const MESSAGE_ORDER = [1, 2, 3, 4, 5, 6];

/**
 * Build array of 6 messages for a user using provided templates.
 * @param {Object} user - { phone, university, city, link }
 * @param {Object} templates - config.messageTemplates (keys 1..6, values function or string)
 * @returns {string[]} [msg1, msg2, ..., msg6]; msg6 may be "" if link missing
 */
function buildSequence(user, templates) {
  if (!user || !templates) return [];
  return MESSAGE_ORDER.map((i) => {
    const t = templates[i];
    if (typeof t === 'function') return t(user);
    return t == null ? '' : String(t);
  });
}

module.exports = { buildSequence };
