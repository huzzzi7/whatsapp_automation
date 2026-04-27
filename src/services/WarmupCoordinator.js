/**
 * Phase 5 — Warm-up coordinator (mirrors CampaignCoordinator patterns).
 */
const { v4: uuidv4 } = require('uuid');
const pool = require('../mysql');
const warmupRepository = require('../repositories/warmupRepository');
const { runWarmupPair } = require('./WarmupPairWorker');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker');

/** In-process guard: one async worker per pair id */
const activePairIds = new Set();

async function listGreenInstances() {
  const [rows] = await pool.execute('SELECT * FROM green_instances ORDER BY createdAt ASC');
  return Array.isArray(rows) ? rows : [];
}

function buildPairs(instances) {
  const list = Array.isArray(instances) ? instances : [];
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!a?.id || !b?.id) continue;
      pairs.push({ senderInstanceDbId: String(a.id), receiverInstanceDbId: String(b.id) });
    }
  }
  return pairs;
}

function schedulePair(pairRow) {
  if (activePairIds.has(pairRow.id)) return;
  activePairIds.add(pairRow.id);
  (async () => {
    try {
      await runWarmupPair(pairRow);
    } catch (err) {
      log.error({ event: 'warmup_pair_worker_error', pairId: pairRow.id, err: err.message }, 'warmup_pair_worker_error');
      await warmupRepository.updatePairStatus(pairRow.id, 'failed', { errorMessage: err.message });
    } finally {
      activePairIds.delete(pairRow.id);
      // If this was the last active pair, session completion can be computed lazily on status endpoint.
    }
  })();
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randInt(min, max) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function getTemplateMsgCount(t) {
  if (!t) return 20;
  if (Array.isArray(t.messagesJson)) return t.messagesJson.length;
  try {
    const arr = JSON.parse(t.messagesJson || '[]');
    return Array.isArray(arr) ? arr.length : 20;
  } catch {
    return 20;
  }
}

async function startWarmupSession() {
  const active = await warmupRepository.getActiveSession();
  if (active) {
    return { session: active, alreadyRunning: true };
  }

  const instances = await listGreenInstances();
  if (instances.length < 2) {
    throw new Error('Warm-up requires at least 2 Green instances');
  }

  const templates = await warmupRepository.getActiveTemplates();
  if (templates.length < 1) {
    throw new Error('No active warmup templates. Seed warmup_templates first.');
  }

  const sessionId = uuidv4();
  const mpp = 32;
  const session = await warmupRepository.createSession(sessionId, mpp);

  const pairSpecs = buildPairs(instances);
  const shuffledTemplates = shuffleInPlace([...templates]);
  const pairsToInsert = pairSpecs.map((p, idx) => {
    const t = shuffledTemplates[idx % shuffledTemplates.length];
    const templateMsgCount = getTemplateMsgCount(t);
    const maxPossible = Math.max(1, templateMsgCount - 2); // leave 2 buffer
    const rawTarget = randInt(25, 40); // 25-40 per pair
    const messagesTarget = Math.min(rawTarget, maxPossible);
    return {
      id: uuidv4(),
      sessionId,
      senderInstanceDbId: p.senderInstanceDbId,
      receiverInstanceDbId: p.receiverInstanceDbId,
      templateId: t.id,
      messagesTarget,
    };
  });

  await warmupRepository.createPairs(pairsToInsert);
  const pairs = await warmupRepository.getPairsBySession(sessionId);

  // Kick all pairs in parallel (one async chain per pair)
  for (const p of pairs) schedulePair(p);

  log.info({ event: 'warmup_session_started', sessionId, pairs: pairs.length, messagesPerPair: mpp }, 'warmup_session_started');
  return { session, pairs, alreadyRunning: false };
}

async function stopWarmupSession(sessionId) {
  const s = await warmupRepository.getSessionById(sessionId);
  if (!s) throw new Error('Session not found');
  if (s.status !== 'running') return { stopped: false, status: s.status };
  await warmupRepository.updateSessionStatus(sessionId, 'stopped');
  return { stopped: true };
}

async function getWarmupStatus(sessionId = null) {
  const session = sessionId ? await warmupRepository.getSessionById(sessionId) : await warmupRepository.getActiveSession();
  if (!session) return { session: null, pairs: [], stats: null };
  const pairs = await warmupRepository.getPairsBySession(session.id);
  const stats = await warmupRepository.getSessionStats(session.id);

  // Auto-complete session when all pairs terminal and session still running
  if (session.status === 'running' && stats.pairsTotal > 0 && stats.pairsActive === 0) {
    const nextStatus = stats.pairsFailed > 0 ? 'failed' : 'completed';
    await warmupRepository.updateSessionStatus(session.id, nextStatus, {
      errorMessage: nextStatus === 'failed' ? 'one_or_more_pairs_failed' : null,
    });
    const updated = await warmupRepository.getSessionById(session.id);
    return { session: updated, pairs, stats };
  }

  return { session, pairs, stats };
}

module.exports = {
  startWarmupSession,
  stopWarmupSession,
  getWarmupStatus,
};

