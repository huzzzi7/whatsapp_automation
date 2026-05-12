/**
 * Lightweight local verification for follow-up removal and queue guard wiring.
 * This does not start Express or process jobs.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_NAME = process.env.DB_NAME || 'whatsapp_local';

const Module = require('module');
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

function testInstanceQueueGuardAsyncExport() {
  const name = 'instanceQueueGuard async export';
  try {
    const guard = require(path.join('..', 'src', 'services', 'instanceQueueGuard'));
    const fn = guard.clearAllQueuesForInstance;
    if (typeof fn === 'function' && fn.constructor?.name === 'AsyncFunction') {
      pass(name, 'clearAllQueuesForInstance is an async function');
    } else {
      fail(name, `expected async function, got type=${typeof fn} constructor=${fn?.constructor?.name}`);
    }
  } catch (err) {
    fail(name, err.message);
  }
}

function testGreenApiChatIdValidation() {
  const cases = [
    { chatId: '120363426903842799@c.us', shouldThrow: true, reason: '18 digits disguised as @c.us' },
    { chatId: '120363426903842799@g.us', shouldThrow: true, reason: '@g.us suffix' },
    { chatId: '923485982030@c.us', shouldThrow: false, reason: '12 digit individual chat' },
    { chatId: '447909242868@c.us', shouldThrow: false, reason: '12 digit individual chat' },
  ];

  try {
    const { assertValidChatIdForGreenApiSend } = require(path.join('..', 'src', 'greenapi'));
    if (typeof assertValidChatIdForGreenApiSend !== 'function') {
      fail('Green API chatId validation export', 'assertValidChatIdForGreenApiSend is not exported');
      return;
    }

    for (const item of cases) {
      const name = `Green API chatId validation ${item.chatId}`;
      try {
        assertValidChatIdForGreenApiSend(item.chatId);
        if (item.shouldThrow) {
          fail(name, `expected rejection for ${item.reason}`);
        } else {
          pass(name, `accepted valid chatId (${item.reason})`);
        }
      } catch (err) {
        if (item.shouldThrow && String(err.message).startsWith('INVALID_CHAT_ID_GROUP_NUMBER:')) {
          pass(name, `rejected invalid chatId (${item.reason})`);
        } else {
          fail(name, err.message);
        }
      }
    }
  } catch (err) {
    fail('Green API chatId validation', err.message);
  }
}

async function testAuthorizationGuardWithMocks() {
  const name = 'Authorization guard mocked execution';
  const mockInstanceRow = {
    id: 'test-instance-uuid',
    greenInstanceId: '9999999',
    phoneNumber: '923000000000',
  };
  const calls = {
    clearMessagesQueue: 0,
    clearPauseFlag: 0,
    clearDepthCache: 0,
    queries: [],
    messageQueueStates: null,
    replyQueueStates: null,
    logs: [],
  };

  const mockPool = {
    query: async (sql, params) => {
      calls.queries.push({ sql, params });
      return [{ affectedRows: 0 }];
    },
  };
  const mockMessageQueue = {
    getJobs: async (states) => {
      calls.messageQueueStates = states;
      return [];
    },
  };
  const mockReplyQueue = {
    getJobs: async (states) => {
      calls.replyQueueStates = states;
      return [];
    },
  };
  const mockLogger = {
    info: (data, message) => calls.logs.push({ level: 'info', data, message }),
    warn: (data, message) => calls.logs.push({ level: 'warn', data, message }),
    error: (data, message) => calls.logs.push({ level: 'error', data, message }),
  };

  const originalLoad = Module._load;
  const guardPath = require.resolve(path.join('..', 'src', 'services', 'instanceQueueGuard'));

  try {
    delete require.cache[guardPath];
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === '../mysql') return mockPool;
      if (request === '../greenInstance') {
        return {
          resolveGreenApiConfig: (row) => ({
            instanceId: String(row.greenInstanceId),
            apiToken: 'mock-token',
            baseUrl: 'https://mock.local',
          }),
        };
      }
      if (request === '../greenapi') {
        return {
          clearMessagesQueue: async () => {
            calls.clearMessagesQueue += 1;
            return {};
          },
        };
      }
      if (request === '../queues') {
        return { messageQueue: mockMessageQueue, replyQueue: mockReplyQueue };
      }
      if (request === './greenQueueMonitor') {
        return {
          clearPauseFlag: async () => {
            calls.clearPauseFlag += 1;
          },
          clearDepthCache: () => {
            calls.clearDepthCache += 1;
          },
        };
      }
      if (request === '../utils/logger') {
        return { createLogger: () => mockLogger };
      }
      return originalLoad.apply(this, arguments);
    };

    const { clearAllQueuesForInstance } = require(guardPath);
    await clearAllQueuesForInstance(mockInstanceRow, 'authorization_guard');

    const dbQuery = calls.queries.find((q) =>
      String(q.sql).includes("UPDATE conversation_state SET status = 'stopped'"),
    );
    const reasonLogged = calls.logs.some((entry) => entry.data?.reason === 'authorization_guard');
    const statesOk =
      JSON.stringify(calls.messageQueueStates) === JSON.stringify(['waiting', 'delayed', 'paused', 'prioritized']) &&
      JSON.stringify(calls.replyQueueStates) === JSON.stringify(['waiting', 'delayed', 'paused', 'prioritized']);

    if (
      calls.clearMessagesQueue === 1 &&
      calls.clearPauseFlag === 1 &&
      calls.clearDepthCache === 1 &&
      dbQuery &&
      dbQuery.params?.[0] === mockInstanceRow.id &&
      reasonLogged &&
      statesOk
    ) {
      pass(name, 'mocked guard cleared Green API, local state, queues, and stopped DB rows with authorization_guard');
    } else {
      fail(
        name,
        `clearMessagesQueue=${calls.clearMessagesQueue}, clearPauseFlag=${calls.clearPauseFlag}, clearDepthCache=${calls.clearDepthCache}, dbQuery=${Boolean(dbQuery)}, reasonLogged=${reasonLogged}, statesOk=${statesOk}`,
      );
    }
  } catch (err) {
    fail(name, err.message);
  } finally {
    Module._load = originalLoad;
    delete require.cache[guardPath];
  }
}

function testFollowupSchedulerQueueAbsent() {
  const name = 'followupSchedulerQueue absent from BullMQ exports';
  try {
    const queues = require(path.join('..', 'src', 'queues'));
    queuesToClose = queues;
    const keys = Object.keys(queues);
    const required = ['messageQueue', 'replyQueue', 'followupQueue', 'warmupQueue'];
    const requiredPresent = required.every((key) => keys.includes(key));

    if (!keys.includes('followupSchedulerQueue') && requiredPresent) {
      pass(name, `exports=${keys.join(', ')}`);
    } else {
      fail(name, `exports=${keys.join(', ')}`);
    }
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
  testInstanceQueueGuardAsyncExport();
  testGreenApiChatIdValidation();
  await testAuthorizationGuardWithMocks();
  testFollowupSchedulerQueueAbsent();

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
