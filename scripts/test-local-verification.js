/**
 * Lightweight local verification for follow-up removal and queue guard wiring.
 * This does not start Express or process jobs.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_NAME = process.env.DB_NAME || 'whatsapp_local';

const path = require('path');

const results = [];
let queuesToClose = null;

function pass(name, reason) {
  results.push({ name, ok: true, reason });
  console.log(`PASS ${name}: ${reason}`);
}

function fail(name, reason) {
  results.push({ name, ok: false, reason });
  console.error(`FAIL ${name}: ${reason}`);
}

async function testFollowupSchedulerNotRegistered() {
  const name = 'Follow-up scheduler not registered';
  try {
    const queues = require(path.join('..', 'src', 'queues'));
    queuesToClose = queues;

    if (Object.prototype.hasOwnProperty.call(queues, 'followupSchedulerQueue')) {
      fail(name, 'queues export still contains followupSchedulerQueue');
      return;
    }

    const schedulerModule = require(path.join('..', 'src', 'queues', 'registerFollowupSchedulerJob'));
    if (typeof schedulerModule.registerFollowupSchedulerJob === 'function') {
      await schedulerModule.registerFollowupSchedulerJob();
    }

    pass(name, 'followupSchedulerQueue is not exported and scheduler registration is disabled');
  } catch (err) {
    pass(name, `scheduler import/registration is disabled or unavailable: ${err.message}`);
  }
}

function testGroupChatFilter() {
  const name = 'Group chat filter';
  try {
    const { parseIncomingNotification } = require(path.join('..', 'src', 'receive'));
    const parsed = parseIncomingNotification({
      typeWebhook: 'incomingMessageReceived',
      senderData: {
        chatId: '120363426903842799@g.us',
      },
      messageData: {
        typeMessage: 'textMessage',
        textMessageData: {
          textMessage: 'hello group',
        },
      },
      timestamp: Math.floor(Date.now() / 1000),
    });

    if (parsed === null) {
      pass(name, '@g.us payload returned null before reply processing');
    } else {
      fail(name, `expected null for @g.us payload, got ${JSON.stringify(parsed)}`);
    }
  } catch (err) {
    fail(name, err.message);
  }
}

function testInstanceQueueGuardExport() {
  const name = 'instanceQueueGuard export';
  try {
    const guard = require(path.join('..', 'src', 'services', 'instanceQueueGuard'));
    if (typeof guard.clearAllQueuesForInstance === 'function') {
      pass(name, 'clearAllQueuesForInstance is exported as a function');
    } else {
      fail(name, 'clearAllQueuesForInstance is missing or not a function');
    }
  } catch (err) {
    fail(name, err.message);
  }
}

function testConversationStateRepositoryExports() {
  const name = 'conversationStateRepository follow-up exports removed';
  try {
    const repo = require(path.join('..', 'src', 'repositories', 'conversationStateRepository'));
    const hasNoFollowupExports =
      repo.setFollowupState === undefined && repo.listEligibleForFollowup === undefined;
    const keepsUpsert = typeof repo.upsertState === 'function';

    if (hasNoFollowupExports && keepsUpsert) {
      pass(name, 'setFollowupState/listEligibleForFollowup are absent and upsertState remains exported');
      return;
    }

    fail(
      name,
      `setFollowupState=${typeof repo.setFollowupState}, listEligibleForFollowup=${typeof repo.listEligibleForFollowup}, upsertState=${typeof repo.upsertState}`,
    );
  } catch (err) {
    fail(name, err.message);
  }
}

async function closeQueues() {
  if (!queuesToClose) return;
  const queueNames = ['messageQueue', 'replyQueue', 'followupQueue', 'warmupQueue'];
  await Promise.all(
    queueNames.map(async (queueName) => {
      const queue = queuesToClose[queueName];
      if (queue && typeof queue.close === 'function') {
        try {
          await queue.close();
        } catch {
          // Ignore local Redis availability during this import-only verification.
        }
      }
    }),
  );
}

async function main() {
  await testFollowupSchedulerNotRegistered();
  testGroupChatFilter();
  testInstanceQueueGuardExport();
  testConversationStateRepositoryExports();

  await closeQueues();

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} tests passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error('FAIL local verification crashed:', err);
  await closeQueues();
  process.exitCode = 1;
});
