/**
 * Express server for WhatsApp automation UI (Meta Cloud API).
 * Serves frontend/dist, handles POST /api/upload, POST /api/campaign/start, POST /api/webhook/meta.
 */
require('dotenv').config();
const { logger } = require('./src/utils/logger');
const { closeCoordinatorWorker } = require('./src/queues/coordinatorWorker');
const { registerCoordinatorJob } = require('./src/queues/registerCoordinatorJob');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('./src/mysql');
const { validateCredentials, requireAuth, requireAdmin } = require('./src/auth');
const { readExcelFromBuffer } = require('./src/excel');
const { toMetaRecipient } = require('./src/phone');
const { processMetaStatusWebhook } = require('./src/processMetaWebhook');
const metaWhatsApp = require('./src/metaWhatsApp');
const {
  createCampaign,
  getNextQueueOrder,
  insertCampaignContacts,
  setTotalContacts,
  getCampaignById,
  updateCampaignSchedule,
  getRunningCampaigns,
  claimQueuedAsRunning,
  claimPausedAsRunning,
  getPausedCampaigns,
  getQueuedCampaigns,
  listCampaigns,
  getCampaignContactsSample,
  countCampaignContacts,
  listCampaignContactsPage,
  updateCampaignStatus,
  deleteCampaignById,
  countPendingContacts,
  countDeliveredContacts,
  getPendingDeliveredCountsByCampaignIds,
} = require('./src/repositories/campaignRepository');
const { tryRunNext } = require('./src/services/CampaignCoordinator');
const metaTemplateRepository = require('./src/repositories/metaTemplateRepository');
const { getMetaConfigRow } = require('./src/repositories/metaConfigRepository');
const { formatCampaign, formatContactSample } = require('./src/utils/campaignFormat');

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

function maskApiToken(token) {
  const t = String(token || '');
  if (t.length < 8) return '****';
  return t.slice(0, 4) + '****' + t.slice(-4);
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

// ── Meta Cloud API webhook (verify + processes delivery status events; no inbound message processing) ──
app.get('/api/webhook/meta', (req, res) => {
  const mode = String(req.query['hub.mode'] || '').trim();
  const token = String(req.query['hub.verify_token'] || '').trim();
  const challenge = req.query['hub.challenge'];
  const expected = String(process.env.META_VERIFY_TOKEN || '').trim();
  if (mode === 'subscribe' && expected && token === expected && challenge != null) {
    console.log('[Meta webhook] GET verify OK');
    return res.status(200).type('text/plain').send(String(challenge));
  }
  console.warn('[Meta webhook] GET verify failed', { mode, tokenMatch: Boolean(expected && token === expected) });
  return res.sendStatus(403);
});

app.post('/api/webhook/meta', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  if (appSecret) {
    const signatureHeader = String(req.get('X-Hub-Signature-256') || '').trim();
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const expected =
      'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
    const sigBuf = Buffer.from(signatureHeader);
    const expBuf = Buffer.from(expected);
    if (
      !signatureHeader ||
      sigBuf.length !== expBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expBuf)
    ) {
      console.warn('[Meta webhook] POST signature mismatch');
      return res.sendStatus(403);
    }
  }
  // Only delivery-status events are processed; inbound message webhooks are still ignored.
  res.sendStatus(200);
  setImmediate(() => {
    processMetaStatusWebhook(req.body).catch((err) => {
      console.error('[Meta webhook] processing error:', err.message);
    });
  });
});

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

// ── Meta Cloud API config (singleton) ─────────────────────────────────
const META_CONFIG_ID = 1;

function mapMetaConfigRow(row, { maskSecrets = true } = {}) {
  if (!row) return null;
  const token = row.accessToken != null ? String(row.accessToken) : '';
  return {
    id: row.id,
    phoneNumberId: row.phoneNumberId != null ? String(row.phoneNumberId) : '',
    displayName: row.displayName != null ? String(row.displayName) : '',
    wabaId: row.wabaId != null ? String(row.wabaId) : '',
    graphVersion: row.graphVersion != null ? String(row.graphVersion) : '',
    isEnabled: Number(row.isEnabled) === 1,
    accessTokenMasked: maskSecrets ? maskApiToken(token) : token,
    hasAccessToken: Boolean(token.trim()),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadMetaConfigRow() {
  const [rows] = await pool.execute('SELECT * FROM meta_config WHERE id = ? LIMIT 1', [META_CONFIG_ID]);
  return rows[0] || null;
}

app.get('/api/meta-config', requireAdmin, async (req, res) => {
  try {
    const row = await loadMetaConfigRow();
    return res.json({
      success: true,
      config: row
        ? mapMetaConfigRow(row)
        : {
            id: META_CONFIG_ID,
            phoneNumberId: '',
            displayName: '',
            wabaId: '',
            graphVersion: '',
            isEnabled: true,
            accessTokenMasked: '',
            hasAccessToken: false,
            createdAt: null,
            updatedAt: null,
          },
      defaults: {
        graphVersion: metaWhatsApp.getGraphVersion(),
        webhookPath: '/api/webhook/meta',
      },
    });
  } catch (err) {
    console.error('[Meta config get]', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to load Meta config' });
  }
});

app.put('/api/meta-config', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const phoneNumberId = body.phoneNumberId != null ? String(body.phoneNumberId).trim() : '';
    const displayName = body.displayName != null ? String(body.displayName).trim() : '';
    const wabaId =
      body.wabaId != null && String(body.wabaId).trim() !== '' ? String(body.wabaId).trim() : null;
    const graphVersion =
      body.graphVersion != null && String(body.graphVersion).trim() !== ''
        ? String(body.graphVersion).trim()
        : null;
    const isEnabled = body.isEnabled === false || body.isEnabled === 0 || body.isEnabled === '0' ? 0 : 1;
    const incomingToken = body.accessToken != null ? String(body.accessToken).trim() : '';

    if (!phoneNumberId) {
      return res.status(400).json({ success: false, error: 'phoneNumberId is required.' });
    }

    const existing = await loadMetaConfigRow();
    let accessToken = incomingToken;
    if (!accessToken) {
      accessToken = existing?.accessToken != null ? String(existing.accessToken) : '';
    }
    if (!accessToken.trim()) {
      return res.status(400).json({ success: false, error: 'accessToken is required.' });
    }

    await pool.execute(
      `INSERT INTO meta_config
        (id, phoneNumberId, accessToken, displayName, wabaId, graphVersion, isEnabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         phoneNumberId = VALUES(phoneNumberId),
         accessToken = VALUES(accessToken),
         displayName = VALUES(displayName),
         wabaId = VALUES(wabaId),
         graphVersion = VALUES(graphVersion),
         isEnabled = VALUES(isEnabled)`,
      [META_CONFIG_ID, phoneNumberId, accessToken, displayName || null, wabaId, graphVersion, isEnabled],
    );

    const row = await loadMetaConfigRow();
    return res.json({ success: true, config: mapMetaConfigRow(row) });
  } catch (err) {
    console.error('[Meta config put]', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to save Meta config' });
  }
});

app.post('/api/meta/test-connection', requireAdmin, async (req, res) => {
  try {
    const row = await loadMetaConfigRow();
    if (!row || !String(row.phoneNumberId || '').trim() || !String(row.accessToken || '').trim()) {
      return res.status(400).json({ success: false, error: 'Save Meta config (phone number ID + token) first.' });
    }
    const data = await metaWhatsApp.getPhoneNumber({
      phoneNumberId: row.phoneNumberId,
      accessToken: row.accessToken,
      graphVersion: row.graphVersion || undefined,
    });
    return res.json({ success: true, phoneNumber: data });
  } catch (err) {
    console.error('[Meta test-connection]', err);
    return res.status(500).json({ success: false, error: err.message || 'Test connection failed' });
  }
});

app.post('/api/meta/test-send', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const toRaw = body.to != null ? String(body.to).trim() : '';
    const templateName = body.templateName != null ? String(body.templateName).trim() : '';
    const languageCode = body.languageCode != null ? String(body.languageCode).trim() : '';
    const components = Array.isArray(body.components) ? body.components : undefined;

    if (!toRaw || !templateName || !languageCode) {
      return res.status(400).json({
        success: false,
        error: 'to, templateName, and languageCode are required.',
      });
    }

    const row = await loadMetaConfigRow();
    if (!row || !String(row.phoneNumberId || '').trim() || !String(row.accessToken || '').trim()) {
      return res.status(400).json({ success: false, error: 'Save Meta config (phone number ID + token) first.' });
    }

    const to = toMetaRecipient(toRaw) || metaWhatsApp.assertMetaRecipient(toRaw);
    const data = await metaWhatsApp.sendTemplate({
      to,
      phoneNumberId: row.phoneNumberId,
      accessToken: row.accessToken,
      templateName,
      languageCode,
      components,
      graphVersion: row.graphVersion || undefined,
    });
    return res.json({ success: true, result: data });
  } catch (err) {
    console.error('[Meta test-send]', err);
    return res.status(500).json({ success: false, error: err.message || 'Test send failed' });
  }
});

// ── Meta templates (registry for campaign use) ─────────────────────────
app.get('/api/meta-templates', requireAdmin, async (req, res) => {
  try {
    const templates = await metaTemplateRepository.listMetaTemplates();
    return res.json({ success: true, templates });
  } catch (err) {
    console.error('[Meta templates list]', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to list templates.' });
  }
});

app.post('/api/meta-templates', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name != null ? String(body.name).trim() : '';
    const languageCode = body.languageCode != null ? String(body.languageCode).trim() : '';
    const category = body.category;
    const variables = Array.isArray(body.variables) ? body.variables : [];
    if (!name || !languageCode) {
      return res.status(400).json({ success: false, error: 'name and languageCode are required.' });
    }
    const template = await metaTemplateRepository.createMetaTemplate({ name, languageCode, category, variables });
    return res.json({ success: true, template });
  } catch (err) {
    console.error('[Meta templates create]', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to create template.' });
  }
});

app.put('/api/meta-templates/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await metaTemplateRepository.getMetaTemplateById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Template not found.' });
    }
    const body = req.body || {};
    const name = body.name != null ? String(body.name).trim() : '';
    const languageCode = body.languageCode != null ? String(body.languageCode).trim() : '';
    const category = body.category;
    const variables = Array.isArray(body.variables) ? body.variables : [];
    if (!name || !languageCode) {
      return res.status(400).json({ success: false, error: 'name and languageCode are required.' });
    }
    const template = await metaTemplateRepository.updateMetaTemplate(req.params.id, {
      name,
      languageCode,
      category,
      variables,
    });
    return res.json({ success: true, template });
  } catch (err) {
    console.error('[Meta templates update]', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to update template.' });
  }
});

app.delete('/api/meta-templates/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await metaTemplateRepository.getMetaTemplateById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Template not found.' });
    }
    await metaTemplateRepository.deleteMetaTemplate(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Meta templates delete]', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to delete template.' });
  }
});

// POST /api/upload – accept .xlsx, parse, return users list
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const mimetype = (req.file.mimetype || '').toLowerCase();
    const name = (req.file.originalname || '').toLowerCase();
    const isXlsx =
      name.endsWith('.xlsx') ||
      mimetype.includes('spreadsheet') ||
      mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!isXlsx) {
      return res.status(400).json({ error: 'Only .xlsx files are allowed.' });
    }

    let users;
    try {
      users = readExcelFromBuffer(req.file.buffer, config.defaultCountryCode);
    } catch (err) {
      return res.status(400).json({ error: `Invalid Excel: ${err.message}` });
    }
    return res.json({ users, totalUsers: users.length });
  } catch (err) {
    console.error('[Upload]', err);
    res.status(500).json({ error: err.message || 'Upload failed.' });
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

function todayIsoInCampaignTz() {
  const tz = process.env.CAMPAIGN_TIMEZONE || 'Europe/London';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const o = {};
  for (const p of parts) {
    if (p.type !== 'literal') o[p.type] = p.value;
  }
  return `${o.year}-${o.month}-${o.day}`;
}

// POST /api/campaign/start – Meta Cloud API campaign
app.post('/api/campaign/start', async (req, res) => {
  const body = req.body || {};
  const {
    users: bodyUsers,
    batchSize,
    scheduledAt: rawScheduledAt,
    campaignStartDate: rawCampaignStartDate,
    campaignEndDate: rawCampaignEndDate,
  } = body;
  const metaTemplateId = body.metaTemplateId != null ? Number(body.metaTemplateId) : null;
  const campaignName = body.name && String(body.name).trim() ? String(body.name).trim() : null;
  if (!bodyUsers || !Array.isArray(bodyUsers) || bodyUsers.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Missing or empty users array.',
    });
  }
  if (!Number.isFinite(metaTemplateId) || metaTemplateId <= 0) {
    return res.status(400).json({ ok: false, error: 'metaTemplateId is required for Meta campaigns.' });
  }

  const operationalStart = '00:00';
  const operationalEnd = '23:59';
  const operationalDays = '0,1,2,3,4,5,6';

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

  let campaignStartDate = null;
  if (rawCampaignStartDate != null && String(rawCampaignStartDate).trim() !== '') {
    const d = new Date(String(rawCampaignStartDate).trim());
    if (!Number.isNaN(d.getTime())) campaignStartDate = toIsoDateString(d);
  }
  if (!campaignStartDate) {
    campaignStartDate = todayIsoInCampaignTz();
  }

  try {
    const template = await metaTemplateRepository.getMetaTemplateById(metaTemplateId);
    if (!template) {
      return res.status(400).json({ ok: false, error: 'Invalid metaTemplateId.' });
    }

    const safeBatchSize = Math.max(1, Math.floor(Number(batchSize) || 20));
    const campaignId = uuidv4();
    const queueOrder = await getNextQueueOrder();
    const dailyLimitPerInstance = Math.min(1800, Math.max(1, Number(body.dailyLimitPerInstance) || 1800));

    let scheduleDate = null;
    if (rawScheduledAt != null && String(rawScheduledAt).trim() !== '') {
      const d = new Date(String(rawScheduledAt).trim());
      if (!Number.isNaN(d.getTime())) scheduleDate = d;
    }

    await createCampaign({
      id: campaignId,
      metaTemplateId,
      name: campaignName,
      batchSize: safeBatchSize,
      totalContacts: bodyUsers.length,
      queueOrder,
      scheduledAt: scheduleDate,
      operationalStart,
      operationalEnd,
      operationalDays,
      campaignStartDate,
      campaignEndDate,
      dailyLimitPerInstance,
    });

    const inserted = await insertCampaignContacts(campaignId, bodyUsers);
    if (inserted === 0) {
      await pool.execute('DELETE FROM campaigns WHERE id = ?', [campaignId]);
      return res.status(400).json({
        ok: false,
        error: 'No valid contacts to queue (each row needs a normalizable phone).',
      });
    }
    await setTotalContacts(campaignId, inserted);

    tryRunNext().catch((err) => {
      console.error('[Campaign coordinator]', err);
    });

    res.json({
      ok: true,
      campaignId,
      jobId: campaignId,
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

// PATCH /api/campaigns/:id – update schedule on paused campaigns only
app.patch('/api/campaigns/:id', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (c.status !== 'paused') {
      return res.status(400).json({
        ok: false,
        error: 'Schedule can only be updated while the campaign is paused.',
      });
    }

    const body = req.body || {};
    const {
      operationalStart: rawOperationalStart,
      operationalEnd: rawOperationalEnd,
      operationalDays: rawOperationalDays,
      campaignStartDate: rawCampaignStartDate,
      campaignEndDate: rawCampaignEndDate,
    } = body;

    if (
      rawOperationalStart == null ||
      String(rawOperationalStart).trim() === '' ||
      rawOperationalEnd == null ||
      String(rawOperationalEnd).trim() === '' ||
      rawOperationalDays == null ||
      String(rawOperationalDays).trim() === '' ||
      rawCampaignStartDate == null ||
      String(rawCampaignStartDate).trim() === '' ||
      rawCampaignEndDate == null ||
      String(rawCampaignEndDate).trim() === ''
    ) {
      return res.status(400).json({
        ok: false,
        error:
          'operationalStart, operationalEnd, operationalDays, campaignStartDate, and campaignEndDate are all required.',
      });
    }

    const parseHhmm = (raw) => {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(raw).trim());
      if (!m) return null;
      const h = Number(m[1]);
      if (!Number.isFinite(h) || h < 0 || h > 23) return null;
      return `${String(h).padStart(2, '0')}:${m[2]}`;
    };

    const operationalStart = parseHhmm(rawOperationalStart);
    const operationalEnd = parseHhmm(rawOperationalEnd);
    const operationalDays = String(rawOperationalDays).trim().slice(0, 20);

    if (!operationalStart || !operationalEnd) {
      return res.status(400).json({
        ok: false,
        error: 'operationalStart and operationalEnd must be in HH:MM format.',
      });
    }
    const startMins =
      Number(operationalStart.slice(0, 2)) * 60 + Number(operationalStart.slice(3, 5));
    const endMins = Number(operationalEnd.slice(0, 2)) * 60 + Number(operationalEnd.slice(3, 5));
    if (!Number.isFinite(startMins) || !Number.isFinite(endMins) || endMins <= startMins) {
      return res.status(400).json({
        ok: false,
        error: 'operationalEnd must be after operationalStart.',
      });
    }

    let hasValidDay = false;
    for (const part of operationalDays.split(',').map((s) => s.trim()).filter(Boolean)) {
      const n = Number(part);
      if (Number.isFinite(n) && n >= 0 && n <= 6) {
        hasValidDay = true;
        break;
      }
    }
    if (!hasValidDay) {
      return res.status(400).json({
        ok: false,
        error: 'operationalDays must include at least one valid day (0–6).',
      });
    }

    const startDateStr = String(rawCampaignStartDate).trim().slice(0, 10);
    const endDateStr = String(rawCampaignEndDate).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) {
      return res.status(400).json({
        ok: false,
        error: 'campaignStartDate must be a valid YYYY-MM-DD date.',
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
      return res.status(400).json({
        ok: false,
        error: 'campaignEndDate must be a valid YYYY-MM-DD date.',
      });
    }
    if (endDateStr < startDateStr) {
      return res.status(400).json({
        ok: false,
        error: 'campaignEndDate must be on or after campaignStartDate.',
      });
    }

    const dailyLimitPerInstance = null;

    const affected = await updateCampaignSchedule(c.id, {
      operationalStart,
      operationalEnd,
      operationalDays,
      campaignStartDate: startDateStr,
      campaignEndDate: endDateStr,
      dailyLimitPerInstance,
    });

    if (affected === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Schedule update failed (campaign may no longer be paused).',
      });
    }

    res.json({ ok: true, dailyLimitPerInstance });
  } catch (err) {
    console.error('[Campaign PATCH schedule]', err);
    res.status(500).json({ ok: false, error: err.message || 'Failed to update campaign schedule.' });
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

// POST /api/campaigns/:id/resume – paused → running
app.post('/api/campaigns/:id/resume', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (c.status !== 'paused') {
      return res.status(400).json({ ok: false, error: 'Only a paused campaign can be resumed.' });
    }
    const claimed = await claimPausedAsRunning(c.id);
    if (claimed !== 1) {
      return res.status(400).json({
        ok: false,
        error:
          'Could not resume: the campaign is no longer paused.',
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

// POST /api/campaigns/:id/start – queued → running
app.post('/api/campaigns/:id/start', async (req, res) => {
  try {
    const c = await getCampaignById(req.params.id);
    if (!c) {
      return res.status(404).json({ ok: false, error: 'Campaign not found.' });
    }
    if (c.status !== 'queued') {
      return res.status(400).json({ ok: false, error: 'Only a queued campaign can be started manually.' });
    }
    const claimed = await claimQueuedAsRunning(c.id);
    if (claimed !== 1) {
      return res.status(400).json({
        ok: false,
        error:
          'Could not start: this campaign is no longer queued.',
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
      return formatCampaign({
        ...row,
        pendingCount: p.pending,
        deliveredCount: p.delivered,
      });
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
    const formatted = formatCampaign({ ...c, pendingCount, deliveredCount });

    if (formatted && c.metaTemplateId) {
      const template = await metaTemplateRepository.getMetaTemplateById(c.metaTemplateId);
      if (template) {
        formatted.metaTemplateName = template.name;
        formatted.metaTemplateLanguageCode = template.languageCode;
      }
    }
    const metaConfig = await getMetaConfigRow();
    if (metaConfig) {
      formatted.metaPhoneNumberId = metaConfig.phoneNumberId;
      formatted.metaPhoneDisplayName = metaConfig.displayName;
    }

    const payload = { campaign: formatted };
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

// GET /api/campaign/status/:jobId – DB campaign row
app.get('/api/campaign/status/:jobId', async (req, res) => {
  try {
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
      { event: 'meta_webhook_route_hint' },
      'Meta webhook (delivery status): GET/POST /api/webhook/meta',
    );
    const { runCoreMigrations } = require('./scripts/ensure-core-tables');

    const startQueueRegistrations = () => {
      require('./src/queues/coordinatorWorker');
      registerCoordinatorJob().catch((err) =>
        logger.error({ err: err.message, event: 'coordinator_register_failed' }, 'Failed to register coordinator job'),
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

startListening();

process.on('SIGTERM', async () => {
  logger.info({ event: 'shutdown_sigterm' }, 'SIGTERM received, closing workers...');
  await closeCoordinatorWorker();
  try {
    await pool.end();
  } catch (e) {
    logger.error({ err: e?.message, event: 'shutdown_pool_end' }, 'MySQL pool.end() failed');
  }
  process.exit(0);
});
process.on('SIGINT', async () => {
  logger.info({ event: 'shutdown_sigint' }, 'SIGINT received, closing workers...');
  await closeCoordinatorWorker();
  try {
    await pool.end();
  } catch (e) {
    logger.error({ err: e?.message, event: 'shutdown_pool_end' }, 'MySQL pool.end() failed');
  }
  process.exit(0);
});
