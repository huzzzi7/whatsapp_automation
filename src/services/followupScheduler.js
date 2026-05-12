const { logger } = require('../utils/logger');

async function runFollowupSchedulerTick() {
  logger.info({ event: 'followup_scheduler_disabled' }, 'followup scheduler disabled');
}

module.exports = { runFollowupSchedulerTick };

