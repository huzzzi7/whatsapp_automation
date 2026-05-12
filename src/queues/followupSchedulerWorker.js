const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

const followupSchedulerWorker = null;

async function closeFollowupSchedulerWorker() {
  log.info({ event: 'followup_scheduler_worker_disabled' }, 'FollowupSchedulerWorker disabled');
}

module.exports = { followupSchedulerWorker, closeFollowupSchedulerWorker };

