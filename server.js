/**
 * Express server for WhatsApp automation UI.
 * Serves frontend/dist, handles POST /api/upload, POST /api/send, POST /api/campaign/start, POST /api/campaign/test-message, POST /api/campaign/test-start, POST /api/webhook/greenapi.
 */
require('dotenv').config();
const { logger } = require('./src/utils/logger');
const { messageQueue, replyQueue } = require('./src/queues');
const { closeWorkers } = require('./src/queues/messageWorker');
const { closeCoordinatorWorker } = require('./src/queues/coordinatorWorker');
const { closeWarmupWorker } = require('./src/queues/warmupWorker');
const { registerCoordinatorJob } = require('./src/queues/registerCoordinatorJob');
const { registerWarmupScheduleJobs } = require('./src/queues/registerWarmupScheduleJobs');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('./src/mysql');
const { validateCredentials, requireAuth, requireAdmin } = require('./src/auth');
const { readExcelFromBuffer } = require('./src/excel');
const { buildSequence } = require('./src/messages');
const { sendAllUsers } = require('./src/send');
const { sendFirstMessageOnly, onIncomingReply, sendFirstMessageOnlyWithStore } = require('./src/replyFlow');
const { normalizePhone, toChatId } = require('./src/phone');
const { controlledSend } = require('./src/services/controlledSend');
const state = require('./src/state');
const testState = require('./src/testState');
const { processGreenApiWebhook, resolveGreenInstanceDbIdFromWebhookBody } = require('./src/processGreenApiWebhook');
const { defaultTemplateStrings } = require('./src/campaignDefaults');
const { resolveGreenApiConfig, maskApiToken } = require('./src/greenInstance');
const { clearMessagesQueue } = require('./src/greenapi');
const { clearPauseFlag, clearDepthCache } = require('./src/services/greenQueueMonitor');
const { createJob, getJob, runCampaignJob } = require('./src/campaignJobs');
const {
  createCampaign,
  getNextQueueOrder,
  insertCampaignContacts,
  setTotalContacts,
  getCampaignById,
  getRunningCampaigns,
  claimQueuedAsRunningIfInstanceFree,
  claimPausedAsRunningIfInstanceFree,
  getPausedCampaigns,
  getQueuedCampaigns,
  listCampaigns,
  getCampaignContactsSample,
  countCampaignContacts,
  listCampaignContactsPage,
  updateCampaignStatus,
  deleteCampaignById,
  updateContactInstanceAssignment,
  countPendingContacts,
  countDeliveredContacts,
  getPendingDeliveredCountsByCampaignIds,
} = require('./src/repositories/campaignRepository');
const { tryRunNext } = require('./src/services/CampaignCoordinator');
const { formatCampaign, formatContactSample } = require('./src/utils/campaignFormat');
const { startWarmupSession, stopWarmupSession, getWarmupStatus } = require('./src/services/WarmupCoordinator');
const warmupRepository = require('./src/repositories/warmupRepository');

const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 19;
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const isSupportedNode = nodeMajor > MIN_NODE_MAJOR || (nodeMajor === MIN_NODE_MAJOR && nodeMinor >= MIN_NODE_MINOR);

if (!isSupportedNode) {
  console.error(
    `[Startup ERROR] Node.js ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+ is required. Current: ${process.versions.node}. ` +
      'Upgrade your runtime to build/serve the Vite frontend reliably (vite@8, @vitejs/plugin-react@6, react-router@7).',
  );
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.SESSION_COOKIE_SECURE === 'true';
const sameSite = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase();

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'whatsapp',
});

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, origin);
      callback(null, false);
    },
    credentials: true,
  })
);

app.use((req, res, next) => {
  logger.debug({ event: 'http_request', method: req.method, url: req.url }, 'http_request');
  next();
});

// Ensure WarmupWorker is bound (Phase 5)
require('./src/queues/warmupWorker');

function testBanner() {
  console.log('=============================');
  console.log('TEST SIMULATION ACTIVE');
  console.log('=============================');
}

function fallbackName(name, email) {
  const n = String(name || '').trim();
  if (n) return n;
  const e = String(email || '').trim().toLowerCase();
  const at = e.indexOf('@');
  return at > 0 ? e.slice(0, at) : e;
}

// Multer: single file in memory, max 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

app.get('/api/config', (req, res) => {
  res.json({
    rateLimitMessagesPerWindow: parseInt(process.env.RATE_LIMIT_MESSAGES_PER_WINDOW || '3', 10),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  });
});

// Webhook: preferred URL — POST /api/webhook/greenapi/<green_instances.id>
app.post(
  '/api/webhook/greenapi/:greenInstanceDbId',
  express.raw({ type: '*/*', limit: '5mb' }),
  (req, res) => {
    console.log(
      '[Webhook] Incoming POST hit:',
      req.params.greenInstanceDbId,
      '| body size:',
      Buffer.isBuffer(req.body) ? req.body.length : req.body?.length || 0,
      'bytes',
    );
    const greenInstanceDbId = String(req.params.greenInstanceDbId || '').trim();
    const rawBuffer = req.body;
    let bodyPreview = '';
    if (Buffer.isBuffer(rawBuffer) && rawBuffer.length > 0) {
      bodyPreview = rawBuffer.toString('utf8').slice(0, 2000);
    }
    console.log('[WEBHOOK_DEBUG] Incoming webhook body (raw slice):', bodyPreview);
    console.log('[WEBHOOK_DEBUG] Instance resolution result:', greenInstanceDbId || null);
    console.log('[WEBHOOK_DEBUG] has valid instance:', Boolean(greenInstanceDbId));
    console.log('[Webhook] Notification received for instance', greenInstanceDbId);
    console.log('[Webhook] Content-Type:', req.get('Content-Type'));
    res.sendStatus(200);

    setImmediate(() => {
      processGreenApiWebhook(rawBuffer, greenInstanceDbId).catch((err) => {
        console.error('[Webhook] Parse or process error:', err.message);
      });
    });
  },
);

// Fallback: POST without /:id — try instanceData.idInstance from body → DB row (enables replies if Green API URL is wrong)
// Also accepts legacy/short paths used by some deployments: /api/greenapi and /greenapi
function handleGreenApiWebhookNoId(req, res) {
  (async () => {
    console.log('[Webhook] Fallback route hit (no instance id in URL)');
    console.log(
      '[Webhook] Fallback route detail:',
      req.method,
      req.originalUrl || req.url,
      'bytes:',
      Buffer.isBuffer(req.body) ? req.body.length : 0,
    );
    let body = null;
    if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      try {
        body = JSON.parse(req.body.toString('utf8'));
      } catch (_) {
        /* handled below */
      }
    }
    const bodyForLog =
      body != null
        ? JSON.stringify(body).slice(0, 2000)
        : Buffer.isBuffer(req.body) && req.body.length > 0
          ? req.body.toString('utf8').slice(0, 500)
          : '(empty or non-JSON)';
    console.log('[WEBHOOK_DEBUG] Incoming webhook body:', bodyForLog);

    let dbInstanceId = null;
    try {
      dbInstanceId = await resolveGreenInstanceDbIdFromWebhookBody(body);
    } catch (e) {
      console.error('[Webhook] Fallback resolution error:', e.message);
    }
    console.log('[WEBHOOK_DEBUG] Instance resolution result:', dbInstanceId);
    console.log('[WEBHOOK_DEBUG] has valid instance:', Boolean(dbInstanceId));

    if (!dbInstanceId) {
      console.error('[WEBHOOK_ERROR] Cannot resolve instance from webhook');
      console.warn(
        `[Webhook] MISCONFIGURED: received POST ${req.originalUrl || req.url} without instance id in the path.`,
      );
      console.warn(
        '[Webhook] Green API must call: POST /api/webhook/greenapi/<green-instance-id> (copy id from Settings → webhook path).',
      );
      console.warn(
        '[Webhook] Or ensure webhook JSON includes instanceData.idInstance matching your saved Green API instance ID.',
      );
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        console.warn('[Webhook] Body preview (first 200 chars):', req.body.toString('utf8').slice(0, 200));
      }
      if (!res.headersSent) {
        res.status(200).json({ ok: false, error: 'instance_resolution_failed' });
      }
      return;
    }

    console.warn(
      '[Webhook] FALLBACK: URL had no /:id; routed using Green API instanceData.idInstance → DB id',
      dbInstanceId,
    );
    console.warn(
      `[Webhook] Prefer configuring Green API to: POST .../api/webhook/greenapi/${dbInstanceId} (explicit instance).`,
    );
    if (!res.headersSent) res.sendStatus(200);
    console.log('[WEBHOOK_DEBUG] has valid instance:', true);
    setImmediate(() => {
      processGreenApiWebhook(req.body, dbInstanceId).catch((err) => {
        console.error('[Webhook] Parse or process error:', err.message);
      });
    });
  })().catch((e) => {
    console.error('[Webhook] Unhandled fallback error:', e);
    if (!res.headersSent) res.status(200).json({ ok: false, error: 'webhook_handler_error' });
  });
}

const greenApiWebhookRaw = express.raw({ type: '*/*', limit: '5mb' });
app.post('/api/webhook/greenapi', greenApiWebhookRaw, handleGreenApiWebhookNoId);
app.post('/api/greenapi', greenApiWebhookRaw, handleGreenApiWebhookNoId);
app.post('/greenapi', greenApiWebhookRaw, handleGreenApiWebhookNoId);

app.use(express.json({ limit: '5mb' }));

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(
  session({
    key: process.env.SESSION_COOKIE_NAME || 'connect.sid',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: cookieSecure,
      httpOnly: true,
      sameSite,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);
const frontendDistPath = path.join(__dirname, 'frontend/dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');
const hasFrontendBuild = fs.existsSync(frontendDistPath) && fs.existsSync(frontendIndexPath);

async function runAuthSchemaAutoMigrations() {
  const statements = [
    "ALTER TABLE green_instances ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE green_instances ADD COLUMN authStatus VARCHAR(50) NOT NULL DEFAULT 'unknown'",
    'ALTER TABLE green_instances ADD COLUMN statusCheckedAt DATETIME NULL',
    'ALTER TABLE green_instances ADD COLUMN manualDisabled TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE campaign_contacts ADD INDEX idx_cc_campaign_status_instance (campaign_id, first_send_status, assigned_instance_id, sort_order)',
  ];

  for (const sql of statements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.execute(sql);
      logger.info({ event: 'auto_migration_ok', sql }, 'Auto-migration OK');
    } catch (err) {
      const msg = err?.message || '';
      const code = err?.code || '';
      const lower = msg.toLowerCase();
      const alreadyExists =
        code === 'ER_DUP_FIELDNAME' ||
        code === 'ER_DUP_KEYNAME' ||
        lower.includes('duplicate column') ||
        lower.includes('duplicate key name');
      if (alreadyExists) {
        logger.info({ event: 'auto_migration_exists', sql }, 'Auto-migration already exists');
      } else {
        logger.warn({ event: 'auto_migration_failed', sql, err: msg }, 'Auto-migration failed (continuing)');
      }
    }
  }
}

if (hasFrontendBuild) {
  app.use(express.static(frontendDistPath));
} else {
  console.warn(
    '[Frontend] Build output not found at frontend/dist. Run "npm run build" before starting the server.',
  );
}

// Auth routes (no requireAuth)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await validateCredentials(email, password);
    if (user) {
      req.session.user = {
        id: user.id,
        email: user.email,
        role: user.role,
      };
      return res.status(200).json({ user: req.session.user });
    }
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.sendStatus(204));
});
app.get('/api/auth/me', (req, res) => {
  if (req.session?.user) return res.status(200).json({ user: req.session.user });
  res.status(401).json({ error: 'Unauthorized' });
});

// Protect all other /api routes (except webhook, which is above)
app.use('/api', (req, res, next) => {
  const p = req.path || '';
  if (p === '/auth/login' || p === '/auth/logout' || p === '/auth/me')
    return next();
  requireAuth(req, res, next);
});

// POST /api/admin/users – create dashboard user (admin only; requireAuth runs above)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password required' });
    }
    const normalized = String(email).trim().toLowerCase();
    const normalizedRole = String(role || 'USER').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
    const [existingRows] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [normalized]);
    if (existingRows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO users (id, name, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)',
      [id, fallbackName(name, normalized), normalized, hash, normalizedRole],
    );
    const [newRows] = await pool.execute(
      'SELECT id, name, email, role, createdAt FROM users WHERE id = ? LIMIT 1',
      [id],
    );
    const newUser = newRows[0];
    res.status(201).json({
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        createdAt: newUser.createdAt,
      },
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users – create dashboard user (admin only)
app.post('/api/users', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const normalized = String(email).trim().toLowerCase();
    const normalizedRole = String(role || 'USER').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
    const [existingRows2] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [normalized]);
    if (existingRows2.length > 0) return res.status(400).json({ error: 'User already exists' });
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await pool.execute(
      'INSERT INTO users (id, name, email, passwordHash, role) VALUES (?, ?, ?, ?, ?)',
      [id, fallbackName(name, normalized), normalized, hash, normalizedRole],
    );
    const [newRows2] = await pool.execute(
      'SELECT id, name, email, role, createdAt FROM users WHERE id = ? LIMIT 1',
      [id],
    );
    const newUser = newRows2[0];
    res.status(201).json({ user: newUser });
  } catch (err) {
    console.error('[User create]', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// GET /api/users – list dashboard users (admin only)
app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.execute(
      'SELECT id, name, email, role, createdAt FROM users ORDER BY createdAt DESC',
    );
    res.json({
      users: users.map((u) => ({
        ...u,
        name: fallbackName(u.name, u.email),
      })),
    });
  } catch (err) {
    console.error('[Users list]', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const [existingRows3] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    const existing = existingRows3[0];
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const [emailOwnerRows] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [normalizedEmail]);
    const emailOwner = emailOwnerRows[0];
    if (emailOwner && emailOwner.id !== existing.id) {
      return res.status(400).json({ error: 'Email is already in use' });
    }

    const nextName = fallbackName(name, normalizedEmail);
    const nextRole = String(role || existing.role).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
    if (password && String(password).trim()) {
      const hash = await bcrypt.hash(String(password), 10);
      await pool.execute(
        'UPDATE users SET name = ?, email = ?, role = ?, passwordHash = ? WHERE id = ?',
        [nextName, normalizedEmail, nextRole, hash, req.params.id],
      );
    } else {
      await pool.execute('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?', [
        nextName,
        normalizedEmail,
        nextRole,
        req.params.id,
      ]);
    }
    const [updatedRows] = await pool.execute(
      'SELECT id, name, email, role, createdAt FROM users WHERE id = ? LIMIT 1',
      [req.params.id],
    );
    const updated = updatedRows[0];
    res.json({ user: updated });
  } catch (err) {
    console.error('[User update]', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  try {
    const [existingRows4] = await pool.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    const existing = existingRows4[0];
    if (!existing) return res.status(404).json({ error: 'User not found' });
    if (req.session?.user?.id === existing.id) {
      return res.status(400).json({ error: 'You cannot delete your own user account.' });
    }
    await pool.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.sendStatus(204);
  } catch (err) {
    console.error('[User delete]', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// POST /api/admin/retry-redis-failed — reset contacts failed by Upstash Redis command limits (requireAuth + requireAdmin)
app.post('/api/admin/retry-redis-failed', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const campaignId =
      body.campaignId != null && String(body.campaignId).trim() !== '' ? String(body.campaignId).trim() : null;
    const likePattern = '%max requests limit%';

    if (campaignId) {
      const [r] = await pool.execute(
        `UPDATE campaign_contacts
         SET first_send_status = 'pending', last_error = NULL, attempt_count = 0
         WHERE first_send_status = 'failed'
           AND last_error LIKE ?
           AND campaign_id = ?`,
        [likePattern, campaignId],
      );
      const contactsReset = Number(r.affectedRows) || 0;
      const [cr] = await pool.execute(
        `UPDATE campaigns
         SET status = 'queued', error_message = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'failed'`,
        [campaignId],
      );
      const campaignsReset = Number(cr.affectedRows) || 0;
      logger.info(
        { event: 'retry_redis_failed', campaignId, contactsReset, campaignsReset },
        'retry-redis-failed: contacts reset to pending',
      );
      tryRunNext().catch((err) =>
        logger.error({ err: err.message, event: 'retry_redis_failed_tryRunNext' }, 'tryRunNext after retry-redis-failed'),
      );
      return res.json({ ok: true, contactsReset, campaignsReset, campaignId });
    }

    const [r] = await pool.execute(
      `UPDATE campaign_contacts
       SET first_send_status = 'pending', last_error = NULL, attempt_count = 0
       WHERE first_send_status = 'failed'
         AND last_error LIKE ?`,
      [likePattern],
    );
    const contactsReset = Number(r.affectedRows) || 0;
    logger.info({ event: 'retry_redis_failed', contactsReset, campaignId: null }, 'retry-redis-failed: all matching contacts reset');
    tryRunNext().catch((err) =>
      logger.error({ err: err.message, event: 'retry_redis_failed_tryRunNext' }, 'tryRunNext after retry-redis-failed'),
    );
    return res.json({ ok: true, contactsReset, campaignsReset: 0, campaignId: null });
  } catch (err) {
    logger.error({ err: err.message, event: 'retry_redis_failed_error' }, 'retry-redis-failed failed');
    res.status(500).json({ ok: false, error: err.message || 'Retry failed.' });
  }
});

// GET /api/campaign/templates – default {{university}} / {{link}} / {{group}} template strings for dashboard modal
app.get('/api/campaign/templates', (req, res) => {
  res.json({ templates: defaultTemplateStrings() });
});

// ============================================================
// Phase 5 — Warm-up System (Anti-Ban Core)
// ============================================================

// POST /api/warmup/start — starts one warmup session (admin only)
app.post('/api/warmup/start', requireAdmin, async (req, res) => {
  try {
    const result = await startWarmupSession();
    const pairsCount = Array.isArray(result?.pairs) ? result.pairs.length : null;
    res.json({
      ok: true,
      alreadyRunning: Boolean(result?.alreadyRunning),
      sessionId: result?.session?.id || result?.sessionId || null,
      pairs: pairsCount,
      session: result?.session || null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Warmup start failed.' });
  }
});

// POST /api/warmup/stop — stops a warmup session (admin only)
app.post('/api/warmup/stop', requireAdmin, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId is required' });
    const result = await stopWarmupSession(sessionId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Warmup stop failed.' });
  }
});

// GET /api/warmup/status — active session or explicit id (admin only)
app.get('/api/warmup/status', requireAdmin, async (req, res) => {
  try {
    const sessionId = req.query?.sessionId != null && String(req.query.sessionId).trim() !== '' ? String(req.query.sessionId).trim() : null;
    const data = await getWarmupStatus(sessionId);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Warmup status failed.' });
  }
});

// GET /api/warmup/templates — list warmup templates (admin only)
app.get('/api/warmup/templates', requireAdmin, async (req, res) => {
  try {
    const templates = await warmupRepository.getAllTemplates();
    res.json({ ok: true, templates });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Warmup templates fetch failed.' });
  }
});

// --- Green API instances (CRUD) ---
app.get('/api/instances', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM green_instances ORDER BY createdAt ASC');
    res.json({
      instances: rows.map((r) => ({
        id: r.id,
        name: r.name,
        phoneNumber: r.phoneNumber,
        greenInstanceId: r.greenInstanceId,
        apiTokenMasked: maskApiToken(r.apiToken),
        /** Path segment for webhooks; full URL = public API host + this path */
        webhookPath: `/api/webhook/greenapi/${r.id}`,
        isActive: r.isActive != null ? Boolean(r.isActive) : true,
        authStatus: r.authStatus || 'unknown',
        statusCheckedAt: r.statusCheckedAt || null,
        manualDisabled: Boolean(r.manualDisabled),
      })),
    });
  } catch (err) {
    console.error('[Instances list]', err);
    res.status(500).json({ error: err.message || 'Failed to list instances' });
  }
});

app.get('/api/instances/:id', requireAdmin, async (req, res) => {
  try {
    const [instRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [req.params.id]);
    const row = instRows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({
      instance: {
        id: row.id,
        name: row.name,
        phoneNumber: row.phoneNumber,
        greenInstanceId: row.greenInstanceId,
        apiToken: row.apiToken,
        webhookPath: `/api/webhook/greenapi/${row.id}`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/instances', requireAdmin, async (req, res) => {
  const { name, phoneNumber, greenInstanceId, apiToken } = req.body || {};
  const n = String(name || '').trim();
  const p = phoneNumber != null ? String(phoneNumber).trim() : '';
  const gid = String(greenInstanceId || '').trim();
  const tok = String(apiToken || '').trim();
  if (!n || !gid || !tok) {
    return res.status(400).json({ error: 'name, greenInstanceId, and apiToken are required.' });
  }
  try {
    const newId = uuidv4();
    await pool.execute(
      'INSERT INTO green_instances (id, name, phoneNumber, greenInstanceId, apiToken) VALUES (?, ?, ?, ?, ?)',
      [newId, n, p, gid, tok],
    );
    const [createdRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [newId]);
    const row = createdRows[0];
    res.status(201).json({
      instance: {
        id: row.id,
        name: row.name,
        phoneNumber: row.phoneNumber,
        greenInstanceId: row.greenInstanceId,
        apiTokenMasked: maskApiToken(row.apiToken),
        webhookPath: `/api/webhook/greenapi/${row.id}`,
      },
    });
  } catch (err) {
    console.error('[Instances create]', err);
    res.status(500).json({ error: err.message || 'Create failed' });
  }
});

app.put('/api/instances/:id', requireAdmin, async (req, res) => {
  const { name, phoneNumber, greenInstanceId, apiToken, manualDisabled } = req.body || {};
  try {
    const [existRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [req.params.id]);
    const existing = existRows[0];
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const n = name !== undefined ? String(name).trim() : existing.name;
    const p = phoneNumber !== undefined ? String(phoneNumber).trim() : existing.phoneNumber;
    const gid = greenInstanceId !== undefined ? String(greenInstanceId).trim() : existing.greenInstanceId;
    let tok = existing.apiToken;
    if (apiToken !== undefined && String(apiToken).trim() !== '') {
      tok = String(apiToken).trim();
    }
    if (!n || !gid || !tok) {
      return res.status(400).json({ error: 'name, greenInstanceId, and apiToken cannot be empty.' });
    }
    const nextManualDisabled =
      manualDisabled != null ? (manualDisabled ? 1 : 0) : existing.manualDisabled != null ? Number(existing.manualDisabled) : 0;
    await pool.execute(
      `UPDATE green_instances
       SET name = ?, phoneNumber = ?, greenInstanceId = ?, apiToken = ?,
           manualDisabled = ?,
           isActive = IF(? = 1, 0, isActive)
       WHERE id = ?`,
      [
        n,
        p,
        gid,
        tok,
        nextManualDisabled,
        nextManualDisabled ? 1 : 0,
        req.params.id,
      ],
    );

    if (manualDisabled != null && Boolean(manualDisabled) !== Boolean(existing.manualDisabled)) {
      const { recalculateActiveCampaigns } = require('./src/services/campaignRecalculator');
      recalculateActiveCampaigns().catch((e) => console.error('[PUT instance] recalc error:', e.message));
    }

    const [updRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [req.params.id]);
    const row = updRows[0];
    res.json({
      instance: {
        id: row.id,
        name: row.name,
        phoneNumber: row.phoneNumber,
        greenInstanceId: row.greenInstanceId,
        apiTokenMasked: maskApiToken(row.apiToken),
        webhookPath: `/api/webhook/greenapi/${row.id}`,
        isActive: row.isActive != null ? Boolean(row.isActive) : true,
        authStatus: row.authStatus || 'unknown',
        statusCheckedAt: row.statusCheckedAt || null,
        manualDisabled: Boolean(row.manualDisabled),
      },
    });
  } catch (err) {
    console.error('[Instances update]', err);
    res.status(500).json({ error: err.message || 'Update failed' });
  }
});

app.post('/api/instances/:id/refresh-status', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { pollSingleInstance } = require('./src/services/instanceStatusPoller');
    await pollSingleInstance(row);
    const { recalculateActiveCampaigns } = require('./src/services/campaignRecalculator');
    await recalculateActiveCampaigns();
    const [updated] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [req.params.id]);
    const r = updated[0];
    res.json({
      id: r.id,
      isActive: Boolean(r.isActive),
      authStatus: r.authStatus || 'unknown',
      statusCheckedAt: r.statusCheckedAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Refresh failed' });
  }
});

app.delete('/api/instances/:id', requireAdmin, async (req, res) => {
  try {
    const [delResult] = await pool.execute('DELETE FROM green_instances WHERE id = ?', [req.params.id]);
    if (delResult.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Delete failed' });
  }
});

// POST /api/instances/:id/clear-queue — Phase 4.3
// Clears Green API outgoing queue + local pause flag + depth cache
app.post('/api/instances/:id/clear-queue', requireAdmin, async (req, res) => {
  const dbId = String(req.params.id || '').trim();
  if (!dbId) {
    return res.status(400).json({ ok: false, error: 'Missing instance id' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [dbId]);
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Instance not found' });
    }

    const greenApi = resolveGreenApiConfig(row);

    let greenResult = null;
    try {
      greenResult = await clearMessagesQueue(greenApi);
    } catch (greenErr) {
      console.error('[ClearQueue] Green API clearMessagesQueue failed:', greenErr.message);
    }

    await clearPauseFlag(greenApi.instanceId);
    clearDepthCache(greenApi.instanceId);

    console.log(`[ClearQueue] Cleared queue for instanceId=${greenApi.instanceId} dbId=${dbId}`);

    return res.json({
      ok: true,
      instanceId: greenApi.instanceId,
      greenResult,
      note:
        greenResult === null
          ? 'Green API clear failed — local state cleared only'
          : 'Green API queue + local state cleared',
    });
  } catch (err) {
    console.error('[ClearQueue] Unexpected error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/upload – accept .xlsx, parse, return users + grouping
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const greenInstanceDbId = String(req.body?.greenInstanceId || '').trim();
    const mimetype = (req.file.mimetype || '').toLowerCase();
    const name = (req.file.originalname || '').toLowerCase();
    const isXlsx =
      name.endsWith('.xlsx') ||
      mimetype.includes('spreadsheet') ||
      mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!isXlsx) {
      return res.status(400).json({ error: 'Only .xlsx files are allowed.' });
    }

    if (greenInstanceDbId) {
      const [instRows2] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [
        greenInstanceDbId,
      ]);
      const inst = instRows2[0];
      if (!inst) {
        return res.status(400).json({ error: 'Invalid greenInstanceId.' });
      }
    }

    let users;
    try {
      users = readExcelFromBuffer(req.file.buffer, config.defaultCountryCode);
    } catch (err) {
      return res.status(400).json({ error: `Invalid Excel: ${err.message}` });
    }

    users.forEach((u) => {
      u.sequence = buildSequence(u, config.messageTemplates);
    });

    const byUniversity = {};
    users.forEach((u) => {
      const key = u.university || '(blank)';
      if (!byUniversity[key]) byUniversity[key] = [];
      byUniversity[key].push(u);
    });
    const universities = Object.keys(byUniversity).sort();

    res.json({
      users,
      byUniversity,
      universities,
      totalUsers: users.length,
    });
  } catch (err) {
    console.error('[Upload]', err);
    res.status(500).json({ error: err.message || 'Upload failed.' });
  }
});

// POST /api/send – scope: "all" | "university", optional university, users[], dryRun, greenInstanceId
app.post('/api/send', async (req, res) => {
  const { scope, university, users: bodyUsers, dryRun, greenInstanceId } = req.body || {};

  if (!scope || !bodyUsers || !Array.isArray(bodyUsers)) {
    return res.status(400).json({
      ok: false,
      error: 'Missing scope or users array.',
    });
  }
  const gid = String(greenInstanceId || '').trim();
  if (!gid) {
    return res.status(400).json({ ok: false, error: 'greenInstanceId is required.' });
  }
  if (scope === 'university' && !university) {
    return res.status(400).json({
      ok: false,
      error: 'university is required when scope is "university".',
    });
  }

  let users = bodyUsers;
  if (scope === 'university') {
    users = bodyUsers.filter((u) => (u.university || '') === university);
  }
  if (users.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'No users to send.',
    });
  }

  try {
    const [sendRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [gid]);
    const row = sendRows[0];
    if (!row) {
      return res.status(400).json({ ok: false, error: 'Invalid greenInstanceId.' });
    }
    const greenApi = resolveGreenApiConfig(row);
    await sendAllUsers(
      users,
      { greenApi, delays: config.delays, messageTemplates: config.messageTemplates },
      { dryRun: !!dryRun, greenInstanceDbId: gid },
    );
    res.json({
      ok: true,
      dryRun: !!dryRun,
      sentCount: users.length,
      replyAutomation: !dryRun,
      message: dryRun
        ? `Dry run: would have sent first message only (reply automation) to ${users.length} users.`
        : `First message sent to ${users.length} users; replies will continue the sequence.`,
    });
  } catch (err) {
    console.error('[Send]', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Send failed.',
    });
  }
});

// POST /api/campaign/log – persist dashboard metrics (after a successful campaign start)
app.post('/api/campaign/log', async (req, res) => {
  try {
    const { campaignId, totalUsers, totalUniversities, universityStats } = req.body || {};
    if (!campaignId || typeof campaignId !== 'string') {
      return res.status(400).json({ error: 'campaignId is required' });
    }
    const tu = Number(totalUsers);
    const tuni = Number(totalUniversities);
    if (!Number.isFinite(tu) || tu < 0 || !Number.isFinite(tuni) || tuni < 0) {
      return res.status(400).json({ error: 'totalUsers and totalUniversities must be non-negative numbers' });
    }
    if (!Array.isArray(universityStats)) {
      return res.status(400).json({ error: 'universityStats must be an array' });
    }
    const logId = uuidv4();
    await pool.execute(
      'INSERT INTO campaign_logs (id, clientCampaignId, totalUsers, totalUniversities, universityStats) VALUES (?, ?, ?, ?, ?)',
      [
        logId,
        String(campaignId).slice(0, 128),
        Math.floor(tu),
        Math.floor(tuni),
        JSON.stringify(universityStats),
      ],
    );
    res.status(201).json({ ok: true, id: logId });
  } catch (err) {
    console.error('[Campaign log]', err);
    res.status(500).json({ error: err.message || 'Failed to save campaign log' });
  }
});

// GET /api/campaign/stats – aggregate metrics for dashboard
app.get('/api/campaign/stats', async (req, res) => {
  try {
    const [logs] = await pool.execute('SELECT * FROM campaign_logs ORDER BY createdAt DESC');
    let totalUsers = 0;
    const uniMap = new Map();
    for (const log of logs) {
      totalUsers += log.totalUsers;
      let stats = log.universityStats;
      if (typeof stats === 'string') {
        try {
          stats = JSON.parse(stats);
        } catch {
          stats = [];
        }
      }
      if (Array.isArray(stats)) {
        for (const row of stats) {
          if (!row || typeof row.name !== 'string') continue;
          const n = Number(row.usersSent);
          const add = Number.isFinite(n) ? Math.floor(n) : 0;
          uniMap.set(row.name, (uniMap.get(row.name) || 0) + add);
        }
      }
    }
    const universityStats = Array.from(uniMap.entries())
      .map(([name, usersSent]) => ({ name, usersSent }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      totalCampaigns: logs.length,
      totalUsers,
      totalUniversities: uniMap.size,
      universityStats,
    });
  } catch (err) {
    console.error('[Campaign stats]', err);
    res.status(500).json({ error: err.message || 'Failed to load stats' });
  }
});

// GET /api/campaign/preview — read-only: instance plan + daily limits (no DB writes)
app.get('/api/campaign/preview', async (req, res) => {
  try {
    const q = req.query || {};
    const totalContacts = Math.max(0, Math.floor(Number(q.totalContacts) || 0));
    const mode = String(q.instanceMode || 'auto').toLowerCase();
    const rawGid = q.greenInstanceId != null ? String(q.greenInstanceId).trim() : '';

    const envOpStart = String(process.env.CAMPAIGN_OPERATIONAL_START || '09:00').trim() || '09:00';
    const envOpEnd = String(process.env.CAMPAIGN_OPERATIONAL_END || '21:00').trim() || '21:00';
    const operationalStart =
      q.operationalStart != null && String(q.operationalStart).trim() !== ''
        ? String(q.operationalStart).trim()
        : envOpStart;
    const operationalEnd =
      q.operationalEnd != null && String(q.operationalEnd).trim() !== ''
        ? String(q.operationalEnd).trim()
        : envOpEnd;
    const operationalDays =
      q.operationalDays != null && String(q.operationalDays).trim() !== ''
        ? String(q.operationalDays).trim()
        : '1,2,3,4,5';

    function hhmmToMinutes(hhmm) {
      const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
      if (!m) return null;
      return Number(m[1]) * 60 + Number(m[2]);
    }

    function toIsoDateString(d) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    let campaignEndDate = null;
    if (q.campaignEndDate != null && String(q.campaignEndDate).trim() !== '') {
      const d = new Date(String(q.campaignEndDate).trim());
      if (!Number.isNaN(d.getTime())) campaignEndDate = toIsoDateString(d);
    }
    if (!campaignEndDate) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 7);
      campaignEndDate = toIsoDateString(d);
    }

    const { getAvailableInstances, calculateDailyLimit } = require('./src/services/instanceLoadBalancer');
    const { getActiveCampaignsDailyLoad } = require('./src/repositories/campaignRepository');

    let instances = [];
    let isMultiInstance = false;
    let dailyLimitPerInstance = null;

    if (mode === 'manual' && rawGid) {
      const [campRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [rawGid]);
      const row = campRows[0];
      if (!row) {
        return res.status(400).json({ ok: false, error: 'Invalid greenInstanceId.' });
      }
      instances = [row];
      isMultiInstance = false;
      dailyLimitPerInstance = null;
    } else if (mode === 'manual' && !rawGid) {
      return res.status(400).json({ ok: false, error: 'greenInstanceId is required for manual mode.' });
    } else {
      instances = await getAvailableInstances();
      if (!instances.length) {
        return res.status(400).json({ ok: false, error: 'No authorized instances available' });
      }
      isMultiInstance = true;
      dailyLimitPerInstance = await calculateDailyLimit(
        totalContacts,
        instances,
        new Date(campaignEndDate),
        operationalDays,
        operationalEnd,
      );

      const maxRatePerMin = parseInt(process.env.RATE_LIMIT_MESSAGES_PER_WINDOW || '3', 10);
      const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
      const opStartMins = hhmmToMinutes(operationalStart) ?? 9 * 60;
      const opEndMins = hhmmToMinutes(operationalEnd) ?? 21 * 60;
      const operationalMinutesPerDay = Math.max(1, opEndMins - opStartMins);
      const physicalMaxPerInstancePerDay = Math.floor(
        (operationalMinutesPerDay / (windowMs / 60000)) * maxRatePerMin,
      );

      let maxExistingLoad = 0;
      for (const inst of instances) {
        const existingLoad = await getActiveCampaignsDailyLoad('', String(inst.id));
        if (existingLoad > maxExistingLoad) maxExistingLoad = existingLoad;
      }
      const availableCapacity = Math.max(1, physicalMaxPerInstancePerDay - maxExistingLoad);
      dailyLimitPerInstance = Math.min(dailyLimitPerInstance, availableCapacity);
    }

    res.json({
      ok: true,
      instanceMode: isMultiInstance ? 'auto' : 'manual',
      instanceCount: instances.length,
      instances: instances.map((r) => ({
        id: r.id,
        name: r.name,
        phoneNumber: r.phoneNumber,
        authStatus: r.authStatus || 'unknown',
        isActive: r.isActive != null ? Boolean(r.isActive) : true,
        dailyLimitPerInstance,
      })),
      dailyLimitPerInstance,
      totalDailyMessages:
        dailyLimitPerInstance != null ? dailyLimitPerInstance * instances.length : null,
      campaignEndDate,
    });
  } catch (err) {
    console.error('[Campaign preview]', err);
    res.status(500).json({ ok: false, error: err.message || 'Campaign preview failed.' });
  }
});

// POST /api/campaign/start – reply-driven: send only message 1 to each user
//
// Production DB: deploying this app does not run migrations. If `campaigns.name` is missing on
// the live database, add it once via Hostinger / phpMyAdmin SQL (safe, no data loss):
//   ALTER TABLE campaigns ADD COLUMN name VARCHAR(255) NULL;
//
app.post('/api/campaign/start', async (req, res) => {
  const body = req.body || {};
  const {
    users: bodyUsers,
    greenInstanceId,
    batchSize,
    scheduledAt: rawScheduledAt,
    operationalStart: rawOperationalStart,
    operationalEnd: rawOperationalEnd,
    operationalDays: rawOperationalDays,
    campaignEndDate: rawCampaignEndDate,
  } = body;
  const campaignName = body.name && String(body.name).trim() ? String(body.name).trim() : null;
  if (!bodyUsers || !Array.isArray(bodyUsers) || bodyUsers.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Missing or empty users array.',
    });
  }

  const envOpStart = String(process.env.CAMPAIGN_OPERATIONAL_START || '09:00').trim() || '09:00';
  const envOpEnd = String(process.env.CAMPAIGN_OPERATIONAL_END || '21:00').trim() || '21:00';
  const operationalStart = rawOperationalStart != null && String(rawOperationalStart).trim() !== '' ? String(rawOperationalStart).trim() : envOpStart;
  const operationalEnd = rawOperationalEnd != null && String(rawOperationalEnd).trim() !== '' ? String(rawOperationalEnd).trim() : envOpEnd;
  const operationalDays =
    rawOperationalDays != null && String(rawOperationalDays).trim() !== ''
      ? String(rawOperationalDays).trim()
      : '1,2,3,4,5';

  function hhmmToMinutes(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function toIsoDateString(d) {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  let campaignEndDate = null;
  if (rawCampaignEndDate != null && String(rawCampaignEndDate).trim() !== '') {
    const d = new Date(String(rawCampaignEndDate).trim());
    if (!Number.isNaN(d.getTime())) campaignEndDate = toIsoDateString(d);
  }
  if (!campaignEndDate) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    campaignEndDate = toIsoDateString(d);
  }

  try {
    const { getAvailableInstances, calculateDailyLimit } = require('./src/services/instanceLoadBalancer');
    const { getActiveCampaignsDailyLoad } = require('./src/repositories/campaignRepository');

    const safeBatchSize = Math.max(1, Math.floor(Number(batchSize) || 20));
    const campaignId = uuidv4();
    const queueOrder = await getNextQueueOrder();

    let scheduleDate = null;
    if (rawScheduledAt != null && String(rawScheduledAt).trim() !== '') {
      const d = new Date(String(rawScheduledAt).trim());
      if (!Number.isNaN(d.getTime())) scheduleDate = d;
    }

    const gid = String(greenInstanceId || '').trim();
    let isMultiInstance = false;
    let instances = [];
    let dailyLimitPerInstance = null;
    let chosenCampaignInstanceId = gid || null;

    if (gid) {
      const [campRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [gid]);
      const row = campRows[0];
      if (!row) {
        return res.status(400).json({ ok: false, error: 'Invalid greenInstanceId.' });
      }
      instances = [row];
      isMultiInstance = false;
      dailyLimitPerInstance = null;
      chosenCampaignInstanceId = gid;
    } else {
      instances = await getAvailableInstances();
      if (!instances.length) {
        return res.status(400).json({ ok: false, error: 'No WhatsApp instances configured' });
      }
      isMultiInstance = true;
      chosenCampaignInstanceId = String(instances[0].id || '').trim();
      dailyLimitPerInstance = await calculateDailyLimit(
        bodyUsers.length,
        instances,
        new Date(campaignEndDate),
        operationalDays,
        operationalEnd,
      );
    }

    await createCampaign({
      id: campaignId,
      greenInstanceId: chosenCampaignInstanceId,
      name: campaignName,
      batchSize: safeBatchSize,
      totalContacts: bodyUsers.length,
      queueOrder,
      scheduledAt: scheduleDate,
      operationalStart,
      operationalEnd,
      operationalDays,
      campaignEndDate,
      dailyLimitPerInstance,
      isMultiInstance,
    });

    // Adjust daily limit for overlap with existing campaigns on same instances
    if (isMultiInstance && dailyLimitPerInstance != null) {
      const maxRatePerMin = parseInt(process.env.RATE_LIMIT_MESSAGES_PER_WINDOW || '3', 10);
      const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
      const opStartMins = hhmmToMinutes(operationalStart) ?? 9 * 60;
      const opEndMins = hhmmToMinutes(operationalEnd) ?? 21 * 60;
      const operationalMinutesPerDay = Math.max(1, opEndMins - opStartMins);
      // Max messages one instance can physically send in operational window
      const physicalMaxPerInstancePerDay = Math.floor(
        (operationalMinutesPerDay / (windowMs / 60000)) * maxRatePerMin,
      );

      let maxExistingLoad = 0;
      for (const inst of instances) {
        const existingLoad = await getActiveCampaignsDailyLoad(campaignId, String(inst.id));
        if (existingLoad > maxExistingLoad) maxExistingLoad = existingLoad;
      }
      const availableCapacity = Math.max(1, physicalMaxPerInstancePerDay - maxExistingLoad);
      // Cap our daily limit to available capacity
      dailyLimitPerInstance = Math.min(dailyLimitPerInstance, availableCapacity);
      // Update the campaign row with adjusted limit
      await pool.execute('UPDATE campaigns SET daily_limit_per_instance = ? WHERE id = ?', [
        dailyLimitPerInstance,
        campaignId,
      ]);
    }

    const inserted = await insertCampaignContacts(campaignId, bodyUsers);
    if (inserted === 0) {
      await pool.execute('DELETE FROM campaigns WHERE id = ?', [campaignId]);
      return res.status(400).json({
        ok: false,
        error: 'No valid contacts to queue (each row needs a normalizable phone).',
      });
    }
    await setTotalContacts(campaignId, inserted);

    // Assign every contact to an instance (single-instance assigns all to the chosen instance)
    if (isMultiInstance) {
      const [contactRows] = await pool.execute(
        'SELECT id FROM campaign_contacts WHERE campaign_id = ? ORDER BY sort_order ASC, id ASC',
        [campaignId],
      );
      const instIds = instances.map((r) => String(r.id || '').trim()).filter(Boolean);
      const instanceCount = instIds.length;
      for (let i = 0; i < contactRows.length; i += 1) {
        const contactId = contactRows[i]?.id;
        const assigned = instIds[i % instanceCount];
        await updateContactInstanceAssignment(contactId, assigned);
      }
    } else {
      await pool.execute('UPDATE campaign_contacts SET assigned_instance_id = ? WHERE campaign_id = ?', [
        chosenCampaignInstanceId,
        campaignId,
      ]);
    }

    tryRunNext().catch((err) => {
      console.error('[Campaign coordinator]', err);
    });

    res.json({
      ok: true,
      campaignId,
      jobId: campaignId,
      instanceCount: instances.length,
      dailyLimitPerInstance,
    });
  } catch (err) {
    console.error('[Campaign]', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Campaign start failed.',
    });
  }
});

// POST /api/campaigns/:id/pause – running → paused (worker exits at batch / pauseCheck boundary)
app.post('/api/campaigns/:id/pause', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (c.status !== 'running') {
      return res.status(400).json({ ok: false, error: 'Only a running campaign can be paused.' });
    }
    await updateCampaignStatus(c.id, 'paused');
    console.log('[Campaign] Campaign paused:', c.id);
    res.json({ ok: true, status: 'paused' });
  } catch (err) {
    console.error('[Campaign pause]', err);
    res.status(500).json({ ok: false, error: err.message || 'Pause failed.' });
  }
});

// POST /api/campaigns/:id/stop – queued | running | paused → stopped (terminal)
app.post('/api/campaigns/:id/stop', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (!['queued', 'running', 'paused'].includes(c.status)) {
      return res.status(400).json({ ok: false, error: 'Campaign cannot be stopped.' });
    }
    await updateCampaignStatus(c.id, 'stopped', {
      errorMessage: 'Stopped by user',
    });
    console.log('[Campaign] Campaign stopped:', c.id);
    tryRunNext().catch((err) => console.error('[Campaign stop] tryRunNext', err));
    res.json({ ok: true, status: 'stopped' });
  } catch (err) {
    console.error('[Campaign stop]', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to stop campaign.' });
  }
});

// POST /api/campaigns/:id/resume – paused → running (per-instance slot enforced atomically in claim)
app.post('/api/campaigns/:id/resume', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (c.status !== 'paused') {
      return res.status(400).json({ ok: false, error: 'Only a paused campaign can be resumed.' });
    }
    const claimed = await claimPausedAsRunningIfInstanceFree(c.id);
    if (claimed !== 1) {
      return res.status(400).json({
        ok: false,
        error:
          'Could not resume: another campaign may already be running on this WhatsApp instance, or the campaign is no longer paused.',
      });
    }
    console.log('[Campaign] Campaign resumed:', c.id);
    tryRunNext().catch((err) => console.error('[Campaign resume] tryRunNext', err));
    res.json({ ok: true, status: 'running' });
  } catch (err) {
    console.error('[Campaign resume]', err);
    res.status(500).json({ ok: false, error: err.message || 'Resume failed.' });
  }
});

// POST /api/campaigns/:id/start – queued → running (per-instance slot enforced atomically in claim)
app.post('/api/campaigns/:id/start', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (c.status !== 'queued') {
      return res.status(400).json({ ok: false, error: 'Only a queued campaign can be started manually.' });
    }
    const claimed = await claimQueuedAsRunningIfInstanceFree(c.id);
    if (claimed !== 1) {
      return res.status(400).json({
        ok: false,
        error:
          'Could not start: another campaign may already be running on this WhatsApp instance, or this campaign is no longer queued.',
      });
    }
    console.log('[Campaign] Queued campaign started manually:', c.id);
    tryRunNext().catch((err) => console.error('[Campaign start] tryRunNext', err));
    res.json({ ok: true, status: 'running' });
  } catch (err) {
    console.error('[Campaign start queued]', err);
    res.status(500).json({ ok: false, error: err.message || 'Start failed.' });
  }
});

// GET /api/campaigns/active – running + paused + queued (register before /api/campaigns/:id)
app.get('/api/campaigns/active', async (req, res) => {
  try {
    logger.debug({ event: 'campaigns_active_fetch' }, 'campaigns_active_fetch');
    const runningAllRows = await getRunningCampaigns();
    const pausedRows = await getPausedCampaigns();
    const queuedRows = await getQueuedCampaigns();
    const allIds = [...runningAllRows, ...pausedRows, ...queuedRows].map((row) => row.id).filter(Boolean);
    const countMap = await getPendingDeliveredCountsByCampaignIds(allIds);
    const mergeCounts = (row) => {
      const p = countMap.get(String(row.id)) || { pending: 0, delivered: 0 };
      return formatCampaign({ ...row, pendingCount: p.pending, deliveredCount: p.delivered });
    };
    const runningAll = runningAllRows.map(mergeCounts);
    const paused = pausedRows.map(mergeCounts);
    const queued = queuedRows.map(mergeCounts);
    res.json({
      running: runningAll[0] ?? null,
      runningAll,
      paused,
      queued,
    });
  } catch (err) {
    console.error('[Campaigns active]', err);
    res.status(500).json({ error: err.message || 'Failed to load active campaigns.' });
  }
});

// GET /api/campaigns – history; optional ?status=completed,failed,paused
app.get('/api/campaigns', async (req, res) => {
  try {
    logger.debug({ event: 'campaigns_history_fetch' }, 'campaigns_history_fetch');
    const raw = String(req.query.status || '').trim();
    const parts = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const campaigns = await listCampaigns({ statuses: parts.length > 0 ? parts : undefined });
    res.json({ campaigns: campaigns.map((c) => formatCampaign(c)) });
  } catch (err) {
    console.error('[Campaigns list]', err);
    res.status(500).json({ error: err.message || 'Failed to list campaigns.' });
  }
});

// DELETE /api/campaigns/:id – remove campaign (CASCADE contacts); not allowed while running
app.delete('/api/campaigns/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await getCampaignById(id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (campaign.status === 'running') {
      return res.status(409).json({
        ok: false,
        error: 'Cannot delete a running campaign. Please stop it first.',
      });
    }
    const stableKey = `campaign-${id}`;
    await pool.execute(
      'UPDATE conversation_state SET campaign_id = NULL WHERE campaign_id IN (?, ?)',
      [id, stableKey],
    );
    const deleted = await deleteCampaignById(id);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: 'Campaign already deleted.' });
    }
    tryRunNext().catch((err) => console.error('[Campaign delete] tryRunNext', err));
    res.json({ ok: true });
  } catch (err) {
    console.error('[Campaign delete]', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to delete campaign.' });
  }
});

// GET /api/campaigns/:id/contacts – paginated recipients (before /api/campaigns/:id)
app.get('/api/campaigns/:id/contacts', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limitRaw = parseInt(String(req.query.limit || '50'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
    const total = await countCampaignContacts(req.params.id);
    const rows = await listCampaignContactsPage(req.params.id, page, limit);
    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
    res.json({
      contacts: rows.map((r) => formatContactSample(r)).filter(Boolean),
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    console.error('[Campaigns contacts]', err);
    res.status(500).json({ error: err.message || 'Failed to load contacts.' });
  }
});

// GET /api/campaigns/:id – single campaign; ?includeContacts=1 adds last 20 contacts
app.get('/api/campaigns/:id', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }
    const pendingCount = await countPendingContacts(req.params.id);
    const deliveredCount = await countDeliveredContacts(req.params.id);
    const payload = {
      campaign: formatCampaign({ ...c, pendingCount, deliveredCount }),
    };
    const inc = String(req.query.includeContacts || '').toLowerCase();
    if (inc === '1' || inc === 'true') {
      const rows = await getCampaignContactsSample(req.params.id, 20);
      payload.contacts = rows.map((r) => formatContactSample(r)).filter(Boolean);
    }
    res.json(payload);
  } catch (err) {
    console.error('[Campaigns detail]', err);
    res.status(500).json({ error: err.message || 'Failed to load campaign.' });
  }
});

// GET /api/campaign/status/:jobId – in-memory job (legacy) or DB campaign row
app.get('/api/campaign/status/:jobId', async (req, res) => {
  try {
  const job = getJob(req.params.jobId);
    if (job) {
  return res.json({
    status: job.status,
    totalUsers: job.totalUsers,
    processedUsers: job.processedUsers,
    batchSize: job.batchSize,
    startedAt: job.startedAt,
    error: job.error || '',
  });
    }

    const c = await getCampaignById(req.params.jobId);
    if (!c) {
      return res.status(404).json({ error: 'Campaign job not found.' });
    }

    const processedUsers =
      c.status === 'completed' || c.status === 'failed'
        ? c.totalContacts
        : Math.min(
            c.totalContacts,
            c.sentCount + (c.failedCount ?? 0) + (c.skippedCount ?? 0),
          );

    const startedAtMs = c.startedAt ? new Date(c.startedAt).getTime() : Date.now();

    return res.json({
      status: c.status,
      totalUsers: c.totalContacts,
      processedUsers,
      batchSize: c.batchSize ?? 20,
      startedAt: startedAtMs,
      error: c.errorMessage || '',
    });
  } catch (err) {
    console.error('[Campaign status]', err);
    res.status(500).json({ error: err.message || 'Status failed.' });
  }
});

// POST /api/campaign/test-message – send message 1 only; registers test conversation state for webhooks
app.post('/api/campaign/test-message', async (req, res) => {
  const { greenInstanceId, phone: rawPhone, sequence } = req.body || {};
  const gid = String(greenInstanceId || '').trim();
  if (!gid) {
    return res.status(200).json({
      ok: false,
      replyAutomation: false,
      warning: 'Replies will not trigger automation until a valid send completes.',
      error: 'greenInstanceId is required.',
    });
  }
  if (!sequence || !Array.isArray(sequence) || sequence.length < 1) {
    return res.status(200).json({
      ok: false,
      replyAutomation: false,
      warning: 'Replies will not trigger automation.',
      error: 'sequence must be a non-empty array.',
    });
  }
  const message1 = String(sequence[0] ?? '').trim();
  if (!message1) {
    return res.status(200).json({
      ok: false,
      replyAutomation: false,
      warning: 'Replies will not trigger automation.',
      error: 'Message 1 (sequence[0]) cannot be empty.',
    });
  }

  const normalized = normalizePhone(rawPhone, config.defaultCountryCode);
  if (!normalized || normalized.length < 10) {
    return res.status(200).json({
      ok: false,
      replyAutomation: false,
      warning: 'Replies will not trigger automation.',
      error: 'Invalid phone number.',
    });
  }
  if (normalized.length > 15) {
    return res.status(200).json({
      ok: false,
      replyAutomation: false,
      warning: 'Replies will not trigger automation.',
      error: 'Phone number is too long (E.164 max 15 digits).',
    });
  }

  try {
    const [tmRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [gid]);
    const row = tmRows[0];
    if (!row) {
      return res.status(200).json({
        ok: false,
        replyAutomation: false,
        warning: 'Replies will not trigger automation.',
        error: 'Invalid greenInstanceId.',
      });
    }
    const greenApi = resolveGreenApiConfig(row);
    const chatId = toChatId(normalized);
    const testSend = await controlledSend({
      instanceId: greenApi.instanceId,
      apiToken: greenApi.apiToken,
      baseUrl: greenApi.baseUrl,
      chatId,
      message: message1,
      context: 'reply',
      messageCount: 0,
      lastMessageAt: undefined,
    });
    if (testSend.skipped) {
      return res.status(200).json({
        ok: false,
        replyAutomation: false,
        warning: 'Replies will not trigger automation.',
        error: 'Message skipped by send pipeline (try again).',
      });
    }

    const seqForState = sequence.map((s) => String(s ?? '').trim());
    const campaignId = `test-msg-${Date.now()}`;
    testState.setState(gid, normalized, {
      lastSentIndex: 1,
      sequence: seqForState,
      campaignId,
    });

    return res.json({
      ok: true,
      replyAutomation: true,
      campaignId,
    });
  } catch (err) {
    console.error('[Test message]', err);
    return res.status(200).json({
      ok: false,
      replyAutomation: false,
      warning: 'Replies will not trigger automation. Use /api/campaign/test-start or fix the error below.',
      error: err.message || 'Send failed.',
    });
  }
});

// POST /api/campaign/test-start – message 1 + testState; replies via onIncomingReplyTest + test-conversation-state.json
app.post('/api/campaign/test-start', async (req, res) => {
  const { greenInstanceId, phone: rawPhone, sequence } = req.body || {};
  const gid = String(greenInstanceId || '').trim();
  if (!gid) {
    return res.status(400).json({ ok: false, error: 'greenInstanceId is required.' });
  }
  if (!sequence || !Array.isArray(sequence) || sequence.length < 1) {
    return res.status(400).json({ ok: false, error: 'sequence must be a non-empty array.' });
  }

  const parts = sequence.map((s) => String(s ?? '').trim()).filter((m) => m.length > 0);
  if (parts.length < 1) {
    return res.status(400).json({ ok: false, error: 'No non-empty messages in sequence.' });
  }

  const firstMessage = parts[0];
  if (!firstMessage || !String(firstMessage).trim()) {
    return res.status(400).json({ ok: false, error: 'First message cannot be empty.' });
  }

  const normalized = normalizePhone(rawPhone, config.defaultCountryCode);
  if (!normalized || normalized.length < 10) {
    return res.status(400).json({ ok: false, error: 'Invalid phone number.' });
  }
  if (normalized.length > 15) {
    return res.status(400).json({ ok: false, error: 'Phone number is too long (E.164 max 15 digits).' });
  }

  try {
    // Clears all test conversations for isolation (separate file from production).
    testState.resetState();
    console.log('[Test start] Cleared test-conversation-state.json (full reset for isolated test run)');

    const [tsRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [gid]);
    const row = tsRows[0];
    if (!row) {
      return res.status(400).json({ ok: false, error: 'Invalid greenInstanceId.' });
    }

    const greenApi = resolveGreenApiConfig(row);
    const { startedUsers } = await sendFirstMessageOnlyWithStore(
      [{ phone: normalized, sequence: parts }],
      config,
      { greenApi, greenInstanceDbId: gid },
      testState,
      'test-',
    );

    if (startedUsers === 0) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to send first test message.',
      });
    }

    return res.json({ ok: true, started: true });
  } catch (err) {
    console.error('[Test start]', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Test start failed.',
    });
  }
});

// GET /api/state – debug: keys are "<greenInstanceDbId>:<phone>" (prod + test files)
app.get('/api/state', (req, res) => {
  try {
    const full = state.loadState();
    const users = {};
    for (const [key, data] of Object.entries(full)) {
      users[key] = {
        lastSentIndex: data.lastSentIndex,
        campaignId: data.campaignId,
      };
    }
    const testFull = testState.loadState();
    const testUsers = {};
    for (const [key, data] of Object.entries(testFull)) {
      testUsers[key] = {
        lastSentIndex: data.lastSentIndex,
        campaignId: data.campaignId,
      };
    }
    res.json({ users, testUsers });
  } catch (err) {
    console.error('[State]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/state/:phone – debug: requires ?greenInstanceId=<db id>
app.get('/api/state/:phone', async (req, res) => {
  const greenInstanceDbId = String(req.query.greenInstanceId || '').trim();
  if (!greenInstanceDbId) {
    return res.status(400).json({ error: 'Query greenInstanceId is required' });
  }
  const raw = req.params.phone || '';
  const phone = String(raw).replace(/\D/g, '') || raw;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  const data = await state.getState(greenInstanceDbId, phone);
  if (data == null) return res.status(404).json({ error: 'Phone not in campaign for this instance' });
  res.json({
    phone,
    greenInstanceId: greenInstanceDbId,
    lastSentIndex: data.lastSentIndex,
    campaignId: data.campaignId,
  });
});

// POST /api/campaign/contacts – create one campaign contact (recipient)
app.post('/api/campaign/contacts', (req, res) => {
  try {
    const { phone, university, city, link, group } = req.body || {};
    const normalized = normalizePhone(phone, config.defaultCountryCode);
    if (!normalized)
      return res.status(400).json({ error: 'Phone is required', field: 'phone' });
    const user = {
      phone: normalized,
      university: university || '',
      city: city || '',
      link: link || '',
      group: group || '',
    };
    user.sequence = buildSequence(user, config.messageTemplates);
    res.status(201).json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Test simulation routes (NODE_ENV !== production only) ---
// POST /api/test/reply – simulate one reply for a phone
app.post('/api/test/reply', async (req, res) => {
  if (isProduction) return res.status(403).json({ error: 'Test routes disabled in production' });
  testBanner();
  const phone = (req.body && req.body.phone) ? String(req.body.phone).replace(/\D/g, '') : '';
  const greenInstanceDbId = String((req.body && req.body.greenInstanceId) || '').trim();
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
  if (!greenInstanceDbId) {
    return res.status(400).json({ success: false, error: 'Missing greenInstanceId' });
  }
  if ((await state.getState(greenInstanceDbId, phone)) == null) {
    return res.status(400).json({ success: false, error: 'phone not in campaign for this instance' });
  }
  const [trRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [
    greenInstanceDbId,
  ]);
  const row = trRows[0];
  if (!row) return res.status(400).json({ success: false, error: 'Invalid greenInstanceId' });
  const greenApi = resolveGreenApiConfig(row);
  console.log('[Test] Simulated reply for', phone);
  await onIncomingReply(phone, { greenApi, greenInstanceDbId });
  res.json({ success: true, phone });
});

// POST /api/test/reply-all – simulate reply for all users in state
app.post('/api/test/reply-all', async (req, res) => {
  if (isProduction) return res.status(403).json({ error: 'Test routes disabled in production' });
  testBanner();
  const full = state.loadState();
  const keys = Object.keys(full);
  console.log('[Test] Simulated replies for all active conversations');
  let n = 0;
  for (const key of keys) {
    const colon = key.indexOf(':');
    if (colon < 1) continue;
    const greenInstanceDbId = key.slice(0, colon);
    const phone = key.slice(colon + 1);
    const [raRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [
      greenInstanceDbId,
    ]);
    const row = raRows[0];
    if (!row) continue;
    const greenApi = resolveGreenApiConfig(row);
    await onIncomingReply(phone, { greenApi, greenInstanceDbId });
    n += 1;
  }
  res.json({ processedKeys: n });
});

// POST /api/test/reset – clear conversation state
app.post('/api/test/reset', (req, res) => {
  if (isProduction) return res.status(403).json({ error: 'Test routes disabled in production' });
  testBanner();
  state.resetState();
  testState.resetState();
  console.log('[Test] Production + test conversation state reset');
  res.json({ status: 'state cleared' });
});

// GET /api/webhook/test – confirm ngrok/routing (no auth)
app.get('/api/webhook/test', (req, res) => {
  res.json({ status: 'webhook working' });
});

app.get('/{*splat}', (req, res) => {
  if (!hasFrontendBuild) {
    return res.status(503).json({
      error:
        'Frontend build not found. Run "npm run build" (or ensure deployment runs it) so frontend/dist/index.html exists.',
    });
  }
  return res.sendFile(frontendIndexPath);
});

logger.info({ event: 'server_starting' }, 'Starting server...');

function startListening() {
  app.listen(PORT, '0.0.0.0', () => {
  logger.info({ event: 'server_listen', port: PORT }, `Server running on port ${PORT}`);
  logger.info(
    { event: 'webhook_route_hint' },
    'Webhook (per instance): POST /api/webhook/greenapi/<green_instances.id>',
  );
  try {
    const prodCount = Object.keys(state.loadState()).length;
    const testCount = Object.keys(testState.loadState()).length;
    logger.info({ event: 'state_loaded', prodKeys: prodCount, testKeys: testCount }, 'Conversation state keys loaded');
  } catch (err) {
    logger.error({ err: err.message, event: 'state_load_error' }, 'State load error');
  }
  // messageWorker is required at file top (with closeWorkers); do not re-require here.
  logger.info({ event: 'bullmq_workers_start_confirmed' }, 'BullMQ message workers bound at process start');
  const { runCoreMigrations } = require('./scripts/ensure-core-tables');

  const startQueueRegistrations = () => {
    // Task 3.4 — BullMQ coordinator replaces setInterval
    require('./src/queues/coordinatorWorker');
    registerCoordinatorJob().catch((err) =>
      logger.error({ err: err.message, event: 'coordinator_register_failed' }, 'Failed to register coordinator job'),
    );
    registerWarmupScheduleJobs().catch((err) =>
      logger.error({ err: err?.message || String(err), event: 'warmup_schedule_register_failed' }, 'warmup schedule register failed'),
    );
    logger.info(
      {
        event: 'bullmq_coordinator_registered',
        coordinatorTickMs: parseInt(process.env.COORDINATOR_TICK_MS || '15000', 10) || 15000,
      },
      'BullMQ coordinator tick registered (see COORDINATOR_TICK_MS)',
    );
  };

  runCoreMigrations()
    .then(() => {
      logger.info('DB migrations verified');
      startQueueRegistrations();
    })
    .catch((err) => {
      logger.error(
        { err: err?.message || String(err) },
        'DB migration failed — some columns may be missing',
      );
      startQueueRegistrations();
    });
  });
}

runAuthSchemaAutoMigrations()
  .catch((err) => {
    logger.error(
      { event: 'auto_migration_failed', err: err?.message || String(err) },
      'AUTO MIGRATION FAILED - run scripts/sql/alter-green-instances-auth.sql manually on live DB',
    );
    console.error(
      '[STARTUP] DB auto-migration failed:',
      err?.message,
      '— run scripts/sql/alter-green-instances-auth.sql manually',
    );
  })
  .finally(async () => {
    startListening();
    try {
      const [colCheck] = await pool.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'green_instances' AND COLUMN_NAME = 'isActive' LIMIT 1",
      );
      if (!colCheck.length) {
        console.error(
          '[Poller] SKIPPED — isActive column missing on green_instances. Run migration manually: scripts/sql/alter-green-instances-auth.sql',
        );
        logger.error(
          { event: 'poller_skipped_missing_column' },
          'Poller skipped: isActive column missing. Run migration manually.',
        );
        return;
      }
      const { startPoller } = require('./src/services/instanceStatusPoller');
      const { recalculateActiveCampaigns } = require('./src/services/campaignRecalculator');
      startPoller(60000, async ({ instanceId, prevIsActive, newIsActive }) => {
        if (prevIsActive !== newIsActive) {
          try {
            await recalculateActiveCampaigns();
          } catch (e) {
            console.error('[Poller] recalculate error:', e.message);
          }
        }
      });
      logger.info({ event: 'poller_start' }, 'Instance status poller started');
    } catch (e) {
      console.error('[Poller] startup check failed:', e.message);
    }
  });

process.on('SIGTERM', async () => {
  logger.info({ event: 'shutdown_sigterm' }, 'SIGTERM received, closing workers...');
  await Promise.all([closeWorkers(), closeCoordinatorWorker(), closeWarmupWorker()]);
  try {
    await pool.end();
  } catch (e) {
    logger.error({ err: e?.message, event: 'shutdown_pool_end' }, 'MySQL pool.end() failed');
  }
  process.exit(0);
});
process.on('SIGINT', async () => {
  logger.info({ event: 'shutdown_sigint' }, 'SIGINT received, closing workers...');
  await Promise.all([closeWorkers(), closeCoordinatorWorker(), closeWarmupWorker()]);
  try {
    await pool.end();
  } catch (e) {
    logger.error({ err: e?.message, event: 'shutdown_pool_end' }, 'MySQL pool.end() failed');
  }
  process.exit(0);
});
