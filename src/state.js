/**
 * Conversation state: persist progress per phone (lastSentIndex, sequence, campaignId).
 * Stored in conversation-state.json at project root.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'conversation-state.json');

let _state = null;

/**
 * Load state from disk. Creates file with {} if missing.
 * @returns {Object} State object keyed by phone
 */
function loadState() {
  if (_state !== null) return _state;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    _state = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      _state = {};
      saveState();
    } else {
      throw err;
    }
  }
  return _state;
}

/**
 * Write state to disk. Call after any change.
 */
function saveState() {
  const state = _state !== null ? _state : loadState();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Get state for a phone number (normalized digits).
 * @param {string} phone - Normalized phone
 * @returns {Object|null} { lastSentIndex, sequence, campaignId } or null
 */
function getState(phone) {
  const state = loadState();
  const key = String(phone || '').trim();
  if (!key) return null;
  return state[key] != null ? state[key] : null;
}

/**
 * Set full state for a phone. Persists immediately.
 * @param {string} phone - Normalized phone
 * @param {Object} data - { lastSentIndex, sequence, campaignId? }
 */
function setState(phone, data) {
  const state = loadState();
  const key = String(phone || '').trim();
  if (!key) return;
  state[key] = data;
  saveState();
}

/**
 * Update only lastSentIndex for a phone. Preserves sequence and campaignId.
 * @param {string} phone - Normalized phone
 * @param {number} newIndex - New lastSentIndex (1..6)
 */
function updateLastSent(phone, newIndex) {
  const state = loadState();
  const key = String(phone || '').trim();
  if (!key || state[key] == null) return;
  state[key].lastSentIndex = newIndex;
  saveState();
}

/**
 * Clear all conversation state (for test reset). Resets in-memory cache and file.
 */
function resetState() {
  _state = {};
  saveState();
}

module.exports = {
  loadState,
  saveState,
  getState,
  setState,
  updateLastSent,
  resetState,
};
