/**
 * Builds Meta Cloud API template `components` (named body parameters) from a registered
 * template's variable list and a per-contact payload (the sheet row keyed by column name).
 */

/**
 * @param {{ variables: string[] }} template
 * @param {object} contactPayload
 * @returns {{ components: Array|undefined, missing: string[] }}
 */
function buildComponentsForTemplate(template, contactPayload) {
  const variables = Array.isArray(template?.variables) ? template.variables : [];
  const payload = contactPayload && typeof contactPayload === 'object' ? contactPayload : {};

  if (variables.length === 0) {
    return { components: undefined, missing: [] };
  }

  const missing = variables.filter((name) => payload[name] == null || String(payload[name]).trim() === '');
  if (missing.length > 0) {
    return { components: undefined, missing };
  }

  const parameters = variables.map((name) => ({
    type: 'text',
    parameter_name: name,
    text: String(payload[name]),
  }));

  return { components: [{ type: 'body', parameters }], missing: [] };
}

module.exports = { buildComponentsForTemplate };
