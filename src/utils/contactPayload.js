/**
 * Parses a campaign_contacts.payload_json cell (per-contact merge fields like university, group,
 * ticket link) back into a plain object. Shared by the deterministic reply sequence and the AI
 * reply pipeline so both read the same fields the same way.
 */
function parseContactPayload(payloadJson) {
  if (payloadJson == null || payloadJson === '') return {};
  try {
    const obj = typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson;
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

module.exports = { parseContactPayload };
