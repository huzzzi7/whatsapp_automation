const pool = require('../mysql');
const { resolveGreenApiConfig } = require('../greenInstance');
const { getStateInstance, getWaSettings } = require('../greenapi');
const { createLogger } = require('../utils/logger');
const { isAuthorizedGreenInstanceState } = require('../utils/greenInstanceAuthState');
const { clearAllQueuesForInstance } = require('./instanceQueueGuard');

const log = createLogger('instancePoller');
let pollerInterval = null;
let pollerStarting = false;
let pollerEnabled = false;
let onStatusChangedCallback = null;
const STARTUP_POLL_STAGGER_MS = Math.max(
  0,
  Math.floor(Number(process.env.INSTANCE_POLLER_STARTUP_STAGGER_MS || '3000') || 3000),
);

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      const rawPhone = waSettings?.phone || waSettings?.wid || '';
      const widDigits = rawPhone.split('@')[0].replace(/\D/g, '');
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
      try {
        await clearAllQueuesForInstance(row, 'phone_swap_detected');
      } catch (err) {
        log.error(
          { event: 'phone_swap_guard_failed', instanceId: row.id, err: err?.message || String(err) },
          'Phone swap queue guard failed',
        );
      }
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

async function pollAllInstances({ staggerMs = 0 } = {}) {
  try {
    const [rows] = await pool.execute('SELECT * FROM green_instances ORDER BY createdAt ASC');
    if (!Array.isArray(rows) || rows.length === 0) return;
    if (staggerMs > 0) {
      for (let i = 0; i < rows.length; i += 1) {
        if (!pollerEnabled) return;
        if (i > 0) await sleep(staggerMs);
        await pollSingleInstance(rows[i]);
      }
      return;
    }
    await Promise.all(rows.map(pollSingleInstance));
  } catch (err) {
    log.error({ event: 'poll_all_error', err: err.message }, 'poll all instances error');
  }
}

function startPoller(intervalMs = 60000, onStatusChanged) {
  if (pollerInterval || pollerStarting) return;
  onStatusChangedCallback = onStatusChanged || null;
  pollerEnabled = true;
  pollerStarting = true;
  log.info(
    { event: 'poller_start', intervalMs, startupStaggerMs: STARTUP_POLL_STAGGER_MS },
    'instance status poller started',
  );
  pollAllInstances({ staggerMs: STARTUP_POLL_STAGGER_MS })
    .catch((err) => log.error({ event: 'startup_poll_error', err: err.message }, 'startup poll error'))
    .finally(() => {
      pollerStarting = false;
      if (!pollerEnabled) return;
      if (pollerInterval) return;
      pollerInterval = setInterval(pollAllInstances, intervalMs);
    });
}

function stopPoller() {
  pollerEnabled = false;
  pollerStarting = false;
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
  }
}

module.exports = { startPoller, stopPoller, pollSingleInstance, pollAllInstances };

