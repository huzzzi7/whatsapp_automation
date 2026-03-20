/**
 * Conversation state: persist progress per (greenInstanceDbId, phone).
 * Keys: `${greenInstanceDbId}:${phone}` — stored in conversation-state.json.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'conversation-state.json');

let _state = null;

function makeStateKey(greenInstanceDbId, phone) {
  const id = String(greenInstanceDbId || '').trim();
  const p = String(phone || '').trim();
  if (!id || !p) return '';
  return `${id}:${p}`;
}

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

function saveState() {
  const state = _state !== null ? _state : loadState();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * @param {string} greenInstanceDbId - Prisma GreenInstance.id
 * @param {string} phone - Normalized phone
 */
function getState(greenInstanceDbId, phone) {
  const state = loadState();
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key) return null;
  return state[key] != null ? state[key] : null;
}

/**
 * @param {string} greenInstanceDbId
 * @param {string} phone
 * @param {{ lastSentIndex: number, sequence: string[], campaignId?: string }} data
 */
function setState(greenInstanceDbId, phone, data) {
  const state = loadState();
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key) return;
  state[key] = data;
  saveState();
}

/**
 * @param {string} greenInstanceDbId
 * @param {string} phone
 * @param {number} newIndex
 */
function updateLastSent(greenInstanceDbId, phone, newIndex) {
  const state = loadState();
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key || state[key] == null) return;
  state[key].lastSentIndex = newIndex;
  saveState();
}

/**
 * Remove conversation state for one (instance, phone) pair.
 * @param {string} greenInstanceDbId
 * @param {string} phone - Normalized phone
 */
function deleteState(greenInstanceDbId, phone) {
  const st = loadState();
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key) return;
  if (st[key] == null) return;
  delete st[key];
  saveState();
}

function resetState() {
  _state = {};
  saveState();
}

module.exports = {
  makeStateKey,
  loadState,
  saveState,
  getState,
  setState,
  updateLastSent,
  deleteState,
  resetState,
};
