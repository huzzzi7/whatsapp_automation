const { randomUUID } = require('crypto');
const { sendFirstMessageOnly } = require('./replyFlow');

const jobs = Object.create(null);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function toDelayInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function toMessageDelaySeconds(value) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = 0;
  if (n < 0) n = 0;
  return Math.floor(n);
}

function sleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkUsers(users, batchSize) {
  const out = [];
  for (let i = 0; i < users.length; i += batchSize) {
    out.push(users.slice(i, i + batchSize));
  }
  return out;
}

function createJob({ users, batchSize, delaySeconds, messageDelaySeconds = 0 }) {
  const safeBatchSize = toPositiveInt(batchSize, 20);
  const safeDelaySeconds = toDelayInt(delaySeconds, 30);
  const safeMessageDelaySeconds = toMessageDelaySeconds(messageDelaySeconds);
  const jobId = randomUUID();
  jobs[jobId] = {
    status: 'running',
    totalUsers: users.length,
    processedUsers: 0,
    startedUsers: 0,
    batchSize: safeBatchSize,
    delaySeconds: safeDelaySeconds,
    messageDelaySeconds: safeMessageDelaySeconds,
    startedAt: Date.now(),
    error: '',
  };
  return {
    jobId,
    batchSize: safeBatchSize,
    delaySeconds: safeDelaySeconds,
    messageDelaySeconds: safeMessageDelaySeconds,
  };
}

function getJob(jobId) {
  return jobs[jobId] || null;
}

async function runCampaignJob(jobId, users, config, opts) {
  const job = jobs[jobId];
  if (!job) return;
  try {
    const batches = chunkUsers(users, job.batchSize);
    const delayMs = job.delaySeconds * 1000;
    const messageDelayMs = Math.max(0, Number(job.messageDelaySeconds) || 0) * 1000;
    const sendOpts = { ...opts, messageDelayMs };
    for (let i = 0; i < batches.length; i += 1) {
      const slice = batches[i];
      const result = await sendFirstMessageOnly(slice, config, sendOpts);
      job.startedUsers += Number(result?.startedUsers || 0);
      job.processedUsers = Math.min(job.totalUsers, job.processedUsers + slice.length);
      if (i < batches.length - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }
    job.status = 'completed';
  } catch (err) {
    job.status = 'failed';
    job.error = err?.message || 'Campaign job failed.';
  }
}

module.exports = {
  createJob,
  getJob,
  runCampaignJob,
};
