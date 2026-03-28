/**
 * Build the 6-message sequence per user from templates.
 * Message 1 uses university; message 6 uses link/group (see config.messageTemplates).
 */
const MESSAGE_ORDER = [1, 2, 3, 4, 5, 6];

/**
 * Build array of 6 messages for a user using provided templates.
 * @param {Object} user - { phone, university, city, link, group? }
 * @param {Object} templates - config.messageTemplates (keys 1..6, values function or string)
 * @returns {string[]} [msg1, msg2, ..., msg6]; msg6 may be "" if link/group missing
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
