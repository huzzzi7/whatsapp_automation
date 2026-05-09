const pool = require('../mysql');
const { resolveGreenApiConfig } = require('../greenInstance');
const { getStateInstance, getWaSettings } = require('../greenapi');
const { createLogger } = require('../utils/logger');
const { isAuthorizedGreenInstanceState } = require('../utils/greenInstanceAuthState');

const log = createLogger('instancePoller');
let pollerInterval = null;
let onStatusChangedCallback = null;

function isAuthorizedState(stateInstance) {
  return isAuthorizedGreenInstanceState(stateInstance);
}

async function pollSingleInstance(row) {
  try {
    const greenApi = resolveGreenApiConfig(row);
    const data = await getStateInstance(greenApi);
    const stateInstance = data?.stateInstance || 'unknown';
    const newIsActive = isAuthorizedState(stateInstance) ? 1 : 0;
    const newAuthStatus = String(stateInstance).slice(0, 50);

    let newPhoneDigits = null;
    try {
      const waSettings = await getWaSettings(greenApi);
      const wid = waSettings?.wid || '';
      const widDigits = wid.split('@')[0].replace(/\D/g, '');
      if (widDigits && widDigits.length >= 7) {
        newPhoneDigits = widDigits;
      }
    } catch (phoneErr) {
      log.warn(
        { event: 'poll_phone_sync_error', instanceId: row.id, err: phoneErr.message },
        'Could not fetch live phone from getWaSettings',
      );
    }

    const prevIsActive = row.isActive;
    const prevAuthStatus = row.authStatus;

    const dbPhoneDigits = String(row.phoneNumber || '').replace(/\D/g, '');
    if (newPhoneDigits != null && newPhoneDigits !== dbPhoneDigits) {
      await pool.execute(
        `UPDATE green_instances
         SET authStatus = ?, isActive = IF(manualDisabled = 1, 0, ?),
             statusCheckedAt = NOW(), phoneNumber = ?
         WHERE id = ?`,
        [newAuthStatus, newIsActive, newPhoneDigits, row.id],
      );
      log.info(
        { event: 'phone_synced', instanceId: row.id, oldPhone: row.phoneNumber, newPhone: newPhoneDigits },
        'Phone number synced from GreenAPI',
      );
    } else {
      await pool.execute(
        `UPDATE green_instances
         SET authStatus = ?, isActive = IF(manualDisabled = 1, 0, ?), statusCheckedAt = NOW()
         WHERE id = ?`,
        [newAuthStatus, newIsActive, row.id],
      );
    }

    const changed = prevIsActive !== newIsActive || prevAuthStatus !== newAuthStatus;
    if (changed && typeof onStatusChangedCallback === 'function') {
      onStatusChangedCallback({ instanceId: row.id, prevIsActive, newIsActive, stateInstance });
    }
  } catch (err) {
    log.warn({ event: 'poll_instance_error', instanceId: row.id, err: err.message }, 'poll error');
  }
}

async function pollAllInstances() {
  try {
    const [rows] = await pool.execute('SELECT * FROM green_instances ORDER BY createdAt ASC');
    if (!Array.isArray(rows) || rows.length === 0) return;
    await Promise.all(rows.map(pollSingleInstance));
  } catch (err) {
    log.error({ event: 'poll_all_error', err: err.message }, 'poll all instances error');
  }
}

function startPoller(intervalMs = 60000, onStatusChanged) {
  if (pollerInterval) return;
  onStatusChangedCallback = onStatusChanged || null;
  log.info({ event: 'poller_start', intervalMs }, 'instance status poller started');
  pollAllInstances(); // immediate first run
  pollerInterval = setInterval(pollAllInstances, intervalMs);
}

function stopPoller() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}

module.exports = { startPoller, stopPoller, pollSingleInstance, pollAllInstances };

