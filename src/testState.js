/**
 * Test-only conversation state: same shape as production state but separate file.
 * Keys: `${greenInstanceDbId}:${phone}` — stored in test-conversation-state.json.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'test-conversation-state.json');

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
  const st = _state !== null ? _state : loadState();
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), 'utf8');
}

function getState(greenInstanceDbId, phone) {
  const st = loadState();
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key) return null;
  return st[key] != null ? st[key] : null;
}

function setState(greenInstanceDbId, phone, data) {
  const st = loadState();
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key) return;
  st[key] = data;
  saveState();
}

function updateLastSent(greenInstanceDbId, phone, newIndex) {
  const st = loadState();
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key || st[key] == null) return;
  st[key].lastSentIndex = newIndex;
  saveState();
}

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
