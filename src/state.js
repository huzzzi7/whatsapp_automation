/**
 * Conversation state: persist progress per (greenInstanceDbId, phone).
 * Keys: `${greenInstanceDbId}:${phone}` — stored in conversation-state.json.
 * Dual-write: same data upserted to MySQL conversation_state; getState reads MySQL first, then file.
 */
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const conversationStateRepository = require('./repositories/conversationStateRepository');

const STATE_FILE = path.join(__dirname, '..', 'conversation-state.json');

let _state = null;
/** Debounced async disk flush so parallel campaign workers do not block the event loop on every send. */
let _persistTimer = null;
/** Bumps on each mutating op so we know when cached JSON is stale. */
let _stateMutationRev = 0;
/** Reuse stringify when state revision matches and cache is fresh (reduces main-thread JSON.stringify under burst writes). */
let _cachedSerializedState = null;
let _serializedCacheRev = -1;
let _serializedCacheAt = 0;

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
      console.error('[STATE LOAD ERROR]', err.message);
      _state = {};
      return _state;
    }
  }
  return _state;
}

function saveState() {
  const state = _state !== null ? _state : loadState();
  try {
    const payload = JSON.stringify(state, null, 2);
    fs.writeFileSync(STATE_FILE, payload, 'utf8');
    _cachedSerializedState = payload;
    _serializedCacheRev = _stateMutationRev;
    _serializedCacheAt = Date.now();
  } catch (err) {
    console.error('[STATE SAVE ERROR]', err.message);
  }
}

function schedulePersistState() {
  if (_persistTimer != null) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    const st = _state !== null ? _state : loadState();
    const now = Date.now();
    const needStringify =
      _cachedSerializedState == null ||
      _serializedCacheRev !== _stateMutationRev ||
      now - _serializedCacheAt > 200;
    let payload;
    if (needStringify) {
      payload = JSON.stringify(st, null, 2);
      _cachedSerializedState = payload;
      _serializedCacheRev = _stateMutationRev;
      _serializedCacheAt = now;
    } else {
      payload = _cachedSerializedState;
    }
    fsPromises.writeFile(STATE_FILE, payload, 'utf8').catch((err) => console.error('[STATE SAVE ERROR]', err.message));
  }, 8);
}

function dualWriteMysqlUpsert(greenInstanceDbId, phone, data) {
  conversationStateRepository
    .upsertState(greenInstanceDbId, phone, data)
    .then(() => {
      console.log('[STATE] Dual write success');
    })
    .catch((err) => {
      console.error('[STATE] MySQL upsert failed:', err.message);
    });
}

function dualWriteMysqlUpdateLastSent(greenInstanceDbId, phone, newIndex) {
  conversationStateRepository
    .updateLastSentUnconditional(greenInstanceDbId, phone, newIndex)
    .then(() => {
      console.log('[STATE] Dual write success');
    })
    .catch((err) => {
      console.error('[STATE] MySQL updateLastSent failed:', err.message);
    });
}

function dualWriteMysqlDelete(greenInstanceDbId, phone) {
  conversationStateRepository
    .deleteState(greenInstanceDbId, phone)
    .then(() => {
      console.log('[STATE] Dual write success');
    })
    .catch((err) => {
      console.error('[STATE] MySQL deleteState failed:', err.message);
    });
}

/**
 * @param {string} greenInstanceDbId - green_instances.id
 * @param {string} phone - Normalized phone
 * @returns {Promise<{ lastSentIndex: number, sequence: string[], campaignId?: string }|null>}
 */
async function getState(greenInstanceDbId, phone) {
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key) return null;

  try {
    const fromDb = await conversationStateRepository.getState(greenInstanceDbId, phone);
    if (fromDb != null) {
      loadState();
      _state[key] = fromDb;
      console.log('[STATE] Loaded from MySQL');
      return fromDb;
    }
  } catch (err) {
    console.error('[STATE] MySQL read error:', err.message);
  }

  loadState();
  const fileData = _state[key] != null ? _state[key] : null;
  if (fileData != null) {
    console.log('[STATE] Fallback to file');
  }
  return fileData;
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
  _stateMutationRev += 1;
  schedulePersistState();
  dualWriteMysqlUpsert(greenInstanceDbId, phone, data);
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
  _stateMutationRev += 1;
  schedulePersistState();
  dualWriteMysqlUpdateLastSent(greenInstanceDbId, phone, newIndex);
}

/**
 * Optimistic lock: advance index in MySQL only if last_sent_index === expectedIndex; sync file cache on success.
 * @param {string} greenInstanceDbId
 * @param {string} phone
 * @param {number} expectedIndex
 * @param {number} newIndex
 * @returns {Promise<{ success: boolean }>}
 */
async function tryAdvanceLastSent(greenInstanceDbId, phone, expectedIndex, newIndex) {
  const key = makeStateKey(greenInstanceDbId, phone);
  if (!key) return { success: false };
  try {
    let { success } = await conversationStateRepository.updateLastSent(
      greenInstanceDbId,
      phone,
      newIndex,
      expectedIndex,
    );
    if (success) {
      loadState();
      if (_state[key] == null) {
        _state[key] = {
          lastSentIndex: newIndex,
          sequence: [],
          campaignId: undefined,
        };
      } else {
        _state[key].lastSentIndex = newIndex;
      }
      _stateMutationRev += 1;
      schedulePersistState();
      console.log('[LOCK_RESULT] success');
      return { success: true };
    }

    console.log('[LOCK_RESULT] fail first_pass; attempting recovery upsert+retry');
    loadState();
    const row = _state[key];
    if (row != null) {
      await conversationStateRepository.upsertState(greenInstanceDbId, phone, {
        lastSentIndex: expectedIndex,
        sequence: Array.isArray(row.sequence) ? row.sequence : [],
        campaignId: row.campaignId,
        status: row.status,
      });
      const retry = await conversationStateRepository.updateLastSent(
        greenInstanceDbId,
        phone,
        newIndex,
        expectedIndex,
      );
      if (retry.success) {
        loadState();
        if (_state[key] == null) {
          _state[key] = {
            lastSentIndex: newIndex,
            sequence: row.sequence || [],
            campaignId: row.campaignId,
            status: row.status,
          };
        } else {
          _state[key].lastSentIndex = newIndex;
        }
        _stateMutationRev += 1;
        schedulePersistState();
        console.log('[LOCK_RESULT] success_via_recovery');
        return { success: true };
      }
    }
    console.log('[LOCK_RESULT] fail_after_recovery');
    return { success: false };
  } catch (err) {
    console.error('[STATE] tryAdvanceLastSent MySQL error:', err.message);
    console.log('[LOCK_RESULT] fail error');
    return { success: false };
  }
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
  _stateMutationRev += 1;
  schedulePersistState();
  dualWriteMysqlDelete(greenInstanceDbId, phone);
}

function resetState() {
  _state = {};
  _stateMutationRev += 1;
  _cachedSerializedState = null;
  _serializedCacheRev = -1;
  saveState();
}

module.exports = {
  makeStateKey,
  loadState,
  saveState,
  getState,
  setState,
  updateLastSent,
  tryAdvanceLastSent,
  deleteState,
  resetState,
};
