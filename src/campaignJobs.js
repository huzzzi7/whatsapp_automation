/**
 * In-memory campaign job tracker (legacy). Only `getJob` is used by GET /api/campaign/status for old jobIds.
 * Production campaigns use DB rows; `createJob` / `runCampaignJob` are retained without legacy delay pacing.
 */
const { randomUUID } = require('crypto');
const { sendFirstMessageOnly } = require('./replyFlow');

const jobs = Object.create(null);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function chunkUsers(users, batchSize) {
  const out = [];
  for (let i = 0; i < users.length; i += batchSize) {
    out.push(users.slice(i, i + batchSize));
  }
  return out;
}

/** @deprecated Prefer DB-backed campaigns; kept for compatibility if anything still creates in-memory jobs. */
function createJob({ users, batchSize }) {
  const safeBatchSize = toPositiveInt(batchSize, 20);
  const jobId = randomUUID();
  jobs[jobId] = {
    status: 'running',
    totalUsers: users.length,
    processedUsers: 0,
    startedUsers: 0,
    batchSize: safeBatchSize,
    startedAt: Date.now(),
    error: '',
  };
  return {
    jobId,
    batchSize: safeBatchSize,
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
    for (let i = 0; i < batches.length; i += 1) {
      const slice = batches[i];
      const result = await sendFirstMessageOnly(slice, config, opts);
      job.startedUsers += Number(result?.startedUsers || 0);
      job.processedUsers = Math.min(job.totalUsers, job.processedUsers + slice.length);
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
