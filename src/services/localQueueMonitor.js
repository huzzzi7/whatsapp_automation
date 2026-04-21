/**
 * Local BullMQ queue depth monitor — Phase 4.4
 * Checks waiting + active job count before processing a send job.
 * Prevents worker from processing when local backlog is too large.
 */
const { messageQueue, replyQueue } = require('../queues/index');

const QUEUE_MAP = {
  messageQueue,
  replyQueue,
};

function getQueueByName(name) {
  return QUEUE_MAP[name] || null;
}

function getLocalQueueMax() {
  const raw = parseInt(process.env.LOCAL_QUEUE_MAX_WAITING || '50', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
}

async function getLocalQueueDepth(queueName) {
  const queue = getQueueByName(queueName);
  if (!queue) {
    console.warn(`[LocalQueueMonitor] Unknown queue name: ${queueName}`);
    return 0;
  }
  try {
    const counts = await queue.getJobCounts('wait', 'active');
    const depth = (counts.wait || 0) + (counts.active || 0);
    return depth;
  } catch (err) {
    console.error(`[LocalQueueMonitor] Failed to get job counts for ${queueName}:`, err.message);
    return 0;
  }
}

module.exports = { getLocalQueueDepth, getLocalQueueMax };
