const pool = require('../mysql');
const { calculateDailyLimit } = require('./instanceLoadBalancer');
const { createLogger } = require('../utils/logger');
const { updateCampaignStatus } = require('../repositories/campaignRepository');

const log = createLogger('recalculator');

let recalcInFlight = false;
let recalcPending = false;

async function _recalculateActiveCampaignsCore() {
  const [snapRows] = await pool.execute(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN isActive = 1 AND manualDisabled = 0 THEN 1 ELSE 0 END), 0) AS activeCount
     FROM green_instances`,
  );
  const snap = snapRows[0] || { total: 0, activeCount: 0 };
  const activeCount = Number(snap.activeCount) || 0;

  if (activeCount === 0) {
    const [running] = await pool.execute(
      `SELECT id, name, is_multi_instance FROM campaigns WHERE status = 'running'`,
    );
    let pausedCount = 0;
    for (const camp of running || []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await updateCampaignStatus(camp.id, 'paused', {
          errorMessage: 'auto_paused: all instances unauthorized',
        });
        pausedCount += 1;
      } catch (err) {
        log.error(
          { event: 'pause_all_instances_failed', campaignId: camp.id, err: err?.message || String(err) },
          'pause campaign failed',
        );
      }
    }
    log.warn(
      {
        event: 'all_instances_unauthorized_campaigns_paused',
        pausedCount,
        runningCandidates: (running || []).length,
        greenInstancesTotal: Number(snap?.total) || 0,
      },
      'all instances unauthorized — paused running campaigns',
    );
    return;
  }

  const [manualDead] = await pool.execute(
    `SELECT c.id, c.green_instance_id AS greenInstanceId
     FROM campaigns c
     INNER JOIN green_instances gi ON gi.id = c.green_instance_id
     WHERE c.status = 'running' AND c.is_multi_instance = 0
       AND (gi.isActive = 0 OR gi.manualDisabled = 1)`,
  );
  for (const row of manualDead || []) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await updateCampaignStatus(row.id, 'paused', {
        errorMessage: 'auto_paused: assigned instance unauthorized',
      });
      log.warn(
        {
          event: 'manual_campaign_paused_instance_unauthorized',
          campaignId: row.id,
          greenInstanceId: row.greenInstanceId,
        },
        'manual campaign paused — assigned instance inactive',
      );
    } catch (err) {
      log.error(
        { event: 'manual_pause_failed', campaignId: row.id, err: err?.message || String(err) },
        'manual campaign pause failed',
      );
    }
  }

  // Only recalculate multi-instance campaigns that are running or queued
  const [campaigns] = await pool.execute(
    `SELECT * FROM campaigns WHERE is_multi_instance = 1 AND status IN ('running','queued')`,
  );
  if (!Array.isArray(campaigns) || campaigns.length === 0) return;

  for (const campaign of campaigns) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await recalculateCampaign(campaign);
    } catch (err) {
      log.error(
        { event: 'recalc_campaign_error', campaignId: campaign.id, err: err.message },
        'recalc error',
      );
    }
  }
}

async function recalculateActiveCampaigns() {
  if (recalcInFlight) {
    recalcPending = true;
    log.debug({ event: 'recalc_skipped_in_flight' }, 'recalc already running, will retry once after');
    return;
  }
  recalcInFlight = true;
  try {
    await _recalculateActiveCampaignsCore();
  } finally {
    recalcInFlight = false;
    if (recalcPending) {
      recalcPending = false;
      setImmediate(() => recalculateActiveCampaigns().catch(() => {}));
    }
  }
}

async function recalculateCampaign(campaign) {
  const campaignId = campaign.id;

  // Get all instances currently assigned to pending contacts in this campaign
  const [assignedRows] = await pool.execute(
    `SELECT DISTINCT cc.assigned_instance_id AS instanceId
     FROM campaign_contacts cc
     WHERE cc.campaign_id = ? AND cc.first_send_status = 'pending' AND cc.assigned_instance_id IS NOT NULL`,
    [campaignId],
  );
  const assignedInstanceIds = assignedRows.map((r) => String(r.instanceId)).filter(Boolean);

  // Get all currently active (authorized) instances
  const [activeRows] = await pool.execute(
    `SELECT * FROM green_instances WHERE isActive = 1 AND manualDisabled = 0 ORDER BY createdAt ASC`,
  );
  const activeIds = activeRows.map((r) => String(r.id));

  // Find deactivated instances (were assigned, now inactive)
  const deactivatedIds = assignedInstanceIds.filter((id) => !activeIds.includes(id));

  // Find newly active instances (active but not yet assigned in this campaign)
  const [allAssignedRows] = await pool.execute(
    `SELECT DISTINCT assigned_instance_id AS instanceId FROM campaign_contacts WHERE campaign_id = ?`,
    [campaignId],
  );
  const everAssignedIds = allAssignedRows.map((r) => String(r.instanceId)).filter(Boolean);
  const newlyActiveIds = activeIds.filter((id) => !everAssignedIds.includes(id));

  const hasChanges = deactivatedIds.length > 0 || newlyActiveIds.length > 0;
  if (!hasChanges) {
    // Still recompute daily limit in case instance count changed
    await updateDailyLimit(campaign, activeRows);
    return;
  }

  // Reassign pending contacts from deactivated instances to active ones
  if (deactivatedIds.length > 0 && activeIds.length > 0) {
    for (const deadId of deactivatedIds) {
      // eslint-disable-next-line no-await-in-loop
      const [pendingContacts] = await pool.execute(
        `SELECT id FROM campaign_contacts
         WHERE campaign_id = ? AND assigned_instance_id = ? AND first_send_status = 'pending'
         ORDER BY sort_order ASC, id ASC`,
        [campaignId, deadId],
      );
      for (let i = 0; i < pendingContacts.length; i++) {
        const newInstanceId = activeIds[i % activeIds.length];
        // eslint-disable-next-line no-await-in-loop
        await pool.execute(`UPDATE campaign_contacts SET assigned_instance_id = ? WHERE id = ?`, [
          newInstanceId,
          pendingContacts[i].id,
        ]);
      }
      log.info(
        { event: 'contacts_reassigned', campaignId, from: deadId, count: pendingContacts.length },
        `reassigned ${pendingContacts.length} contacts from deactivated instance`,
      );
    }
  }

  // Distribute unassigned pending contacts to newly active instances
  if (newlyActiveIds.length > 0) {
    const [unassigned] = await pool.execute(
      `SELECT id FROM campaign_contacts
       WHERE campaign_id = ? AND (assigned_instance_id IS NULL OR assigned_instance_id = '')
       AND first_send_status = 'pending'
       ORDER BY sort_order ASC, id ASC`,
      [campaignId],
    );
    for (let i = 0; i < unassigned.length; i++) {
      const newInstanceId = newlyActiveIds[i % newlyActiveIds.length];
      // eslint-disable-next-line no-await-in-loop
      await pool.execute(`UPDATE campaign_contacts SET assigned_instance_id = ? WHERE id = ?`, [
        newInstanceId,
        unassigned[i].id,
      ]);
    }
  }

  // Recompute and persist daily limit
  await updateDailyLimit(campaign, activeRows);
}

async function updateDailyLimit(campaign, activeInstances) {
  if (!Array.isArray(activeInstances) || activeInstances.length === 0) return;
  const [pendingCount] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM campaign_contacts WHERE campaign_id = ? AND first_send_status = 'pending'`,
    [campaign.id],
  );
  const remaining = pendingCount[0]?.cnt || 0;
  if (remaining === 0) return;

  const campaignEndDate = campaign.campaign_end_date ?? campaign.campaignEndDate ?? null;
  const operationalDays = campaign.operational_days ?? campaign.operationalDays ?? null;
  const operationalEnd = campaign.operational_end ?? campaign.operationalEnd ?? null;

  const newLimit = await calculateDailyLimit(
    remaining,
    activeInstances,
    campaignEndDate,
    operationalDays,
    operationalEnd,
  );

  await pool.execute(`UPDATE campaigns SET daily_limit_per_instance = ? WHERE id = ?`, [
    newLimit,
    campaign.id,
  ]);
  log.info(
    {
      event: 'daily_limit_updated',
      campaignId: campaign.id,
      newLimit,
      instanceCount: activeInstances.length,
    },
    'daily limit recalculated',
  );
}

module.exports = { recalculateActiveCampaigns };

