/**
 * BullMQ queue singletons (one instance per process).
 */
const { Queue } = require('bullmq');
const { bullMqConnection, bullMqSkipVersionCheck } = require('./connection');
const { createLogger } = require('../utils/logger');

const qlog = createLogger('worker');

const defaultJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

const queueOpts = {
  connection: bullMqConnection,
  defaultJobOptions,
  skipVersionCheck: bullMqSkipVersionCheck,
};

const messageQueue = new Queue('messageQueue', queueOpts);
const replyQueue = new Queue('replyQueue', queueOpts);
const followupQueue = new Queue('followupQueue', queueOpts);

function attachErrorHandler(queue, name) {
  queue.on('error', (err) => {
    qlog.error({ event: 'queue_error', queue: name, err: err?.message || String(err) }, 'Queue error');
  });
}

attachErrorHandler(messageQueue, 'messageQueue');
attachErrorHandler(replyQueue, 'replyQueue');
attachErrorHandler(followupQueue, 'followupQueue');

qlog.info({ event: 'queues_initialized', queues: ['messageQueue', 'replyQueue', 'followupQueue'] }, 'BullMQ queues initialized');

module.exports = {
  messageQueue,
  replyQueue,
  followupQueue,
};
