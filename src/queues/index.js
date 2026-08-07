/**
 * BullMQ queue singletons (one instance per process).
 */
const { Queue } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { createLogger } = require('../utils/logger');

const qlog = createLogger('worker');

const defaultJobOptions = {
  removeOnComplete: { count: 20 },
  removeOnFail: { count: 50 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

const queueOpts = {
  connection: bullMqConnection,
  defaultJobOptions,
  skipVersionCheck: bullMqSkipVersionCheck,
};

const followupQueue = new Queue('followupQueue', queueOpts);

followupQueue.on('error', (err) => {
  qlog.error({ event: 'queue_error', queue: 'followupQueue', err: err?.message || String(err) }, 'Queue error');
});

// Delayed, debounced AI free-text reply sends (human-like delay + typing indicator).
const aiReplyQueue = new Queue('aiReplyQueue', queueOpts);

aiReplyQueue.on('error', (err) => {
  qlog.error({ event: 'queue_error', queue: 'aiReplyQueue', err: err?.message || String(err) }, 'Queue error');
});

qlog.info(
  { event: 'queues_initialized', queues: ['followupQueue', 'aiReplyQueue'] },
  'BullMQ queues initialized',
);

module.exports = { followupQueue, aiReplyQueue };
