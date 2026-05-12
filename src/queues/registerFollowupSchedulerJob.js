const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

async function registerFollowupSchedulerJob() {
  log.info({ event: 'followup_scheduler_registration_disabled' }, 'followup scheduler registration disabled');
}

module.exports = { registerFollowupSchedulerJob };

