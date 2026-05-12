const pool = require('../mysql');
const { resolveGreenApiConfig } = require('../greenInstance');
const { clearMessagesQueue } = require('../greenapi');
const { messageQueue, replyQueue } = require('../queues');
const { clearPauseFlag, clearDepthCache } = require('./greenQueueMonitor');
const { createLogger } = require('../utils/logger');

const log = createLogger('instanceGuard');
const JOB_STATES_TO_CLEAR = ['waiting', 'delayed', 'paused', 'prioritized'];

function matchesInstance(jobData, instanceRow, greenApi) {
  const jobGid = jobData?.greenInstanceDbId != null ? String(jobData.greenInstanceDbId).trim() : '';
  const jobInstanceId = jobData?.instanceId != null ? String(jobData.instanceId).trim() : '';
  const rowDbId = instanceRow?.id != null ? String(instanceRow.id).trim() : '';
  const rowGreenId = instanceRow?.greenInstanceId != null ? String(instanceRow.greenInstanceId).trim() : '';
  const apiInstanceId = greenApi?.instanceId != null ? String(greenApi.instanceId).trim() : '';

  return Boolean(
    (rowDbId && jobGid === rowDbId) ||
      (rowGreenId && jobInstanceId === rowGreenId) ||
      (apiInstanceId && jobInstanceId === apiInstanceId),
  );
}

async function removeMatchingJobs(queue, queueName, instanceRow, greenApi) {
  let jobsRemoved = 0;
  let jobsSkipped = 0;

  const jobs = await queue.getJobs(JOB_STATES_TO_CLEAR, 0, -1);
  for (const job of jobs) {
    if (!matchesInstance(job?.data, instanceRow, greenApi)) continue;
    try {
      await job.remove();
      jobsRemoved += 1;
    } catch (err) {
      jobsSkipped += 1;
      log.warn(
        {
          event: 'instance_guard_job_remove_failed',
          queue: queueName,
          bullJobId: job?.id != null ? String(job.id) : undefined,
          err: err?.message || String(err),
        },
        'instanceQueueGuard job remove failed',
      );
    }
  }

  return { jobsRemoved, jobsSkipped };
}

async function clearAllQueuesForInstance(instanceRow, reason) {
  if (!instanceRow || !instanceRow.id) {
    throw new Error('clearAllQueuesForInstance requires a green_instances row');
  }

  const greenApi = resolveGreenApiConfig(instanceRow);
  const guardReason = reason != null && String(reason).trim() !== '' ? String(reason).trim() : 'unknown';
  let greenCleared = false;
  let jobsRemoved = 0;
  let jobsSkipped = 0;
  let rowsStopped = 0;

  try {
    await clearMessagesQueue(greenApi);
    greenCleared = true;
  } catch (err) {
    log.warn(
      {
        event: 'instance_guard_green_clear_failed',
        instanceDbId: instanceRow.id,
        greenInstanceId: greenApi.instanceId,
        phone: instanceRow.phoneNumber,
        reason: guardReason,
        err: err?.message || String(err),
      },
      'instanceQueueGuard Green API clear failed',
    );
  }

  try {
    await clearPauseFlag(greenApi.instanceId);
  } catch (err) {
    log.warn(
      {
        event: 'instance_guard_pause_clear_failed',
        instanceDbId: instanceRow.id,
        greenInstanceId: greenApi.instanceId,
        reason: guardReason,
        err: err?.message || String(err),
      },
      'instanceQueueGuard pause clear failed',
    );
  }

  try {
    clearDepthCache(greenApi.instanceId);
  } catch (err) {
    log.warn(
      {
        event: 'instance_guard_depth_cache_clear_failed',
        instanceDbId: instanceRow.id,
        greenInstanceId: greenApi.instanceId,
        reason: guardReason,
        err: err?.message || String(err),
      },
      'instanceQueueGuard depth cache clear failed',
    );
  }

  const queueResults = await Promise.all([
    removeMatchingJobs(messageQueue, 'messageQueue', instanceRow, greenApi),
    removeMatchingJobs(replyQueue, 'replyQueue', instanceRow, greenApi),
  ]);
  for (const result of queueResults) {
    jobsRemoved += result.jobsRemoved;
    jobsSkipped += result.jobsSkipped;
  }

  const [result] = await pool.query(
    "UPDATE conversation_state SET status = 'stopped', updated_at = NOW(3) WHERE green_instance_db_id = ?",
    [instanceRow.id],
  );
  rowsStopped = Number(result?.affectedRows) || 0;

  log.info(
    {
      event: 'instance_queue_guard_cleared',
      instanceDbId: instanceRow.id,
      greenInstanceId: instanceRow.greenInstanceId,
      phone: instanceRow.phoneNumber,
      reason: guardReason,
      greenCleared,
      jobsRemoved,
      jobsSkipped,
      rowsStopped,
    },
    'instanceQueueGuard cleared',
  );

  return { greenCleared, jobsRemoved, jobsSkipped, rowsStopped };
}

module.exports = { clearAllQueuesForInstance };
