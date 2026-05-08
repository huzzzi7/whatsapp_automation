/**
 * GreenAPI stateInstance / webhook status — exact match only (not substring).
 * Avoids treating "notAuthorized" as authorized (it contains "authorized").
 */
function isAuthorizedGreenInstanceState(stateInstance) {
  const s = String(stateInstance || '').toLowerCase().trim();
  return s === 'authorized' || s === 'connected' || s === 'yellowcard';
}

module.exports = { isAuthorizedGreenInstanceState };
