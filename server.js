/**
 * Express server for WhatsApp automation UI.
 * Serves public/, handles POST /api/upload, POST /api/send, POST /api/campaign/start, POST /api/campaign/test-message, POST /api/campaign/test-start, POST /api/webhook/greenapi.
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
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
const { sendMessage: greenSendMessage } = require('./src/greenapi');
const state = require('./src/state');
const testState = require('./src/testState');
const { processGreenApiWebhook, resolveGreenInstanceDbIdFromWebhookBody } = require('./src/processGreenApiWebhook');
const { defaultTemplateStrings } = require('./src/campaignDefaults');
const { resolveGreenApiConfig, maskApiToken } = require('./src/greenInstance');
const { createJob, getJob, runCampaignJob } = require('./src/campaignJobs');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const cookieSecure = process.env.SESSION_COOKIE_SECURE === 'true' || isProduction;
const sameSite = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase();

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
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

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

// Webhook: preferred URL — POST /api/webhook/greenapi/<green_instances.id>
app.post(
  '/api/webhook/greenapi/:greenInstanceDbId',
  express.raw({ type: '*/*', limit: '5mb' }),
  (req, res) => {
    console.log('[Webhook] Notification received for instance', req.params.greenInstanceDbId);
    console.log('[Webhook] Content-Type:', req.get('Content-Type'));
    res.sendStatus(200);

    const greenInstanceDbId = req.params.greenInstanceDbId;
    const rawBuffer = req.body;
    setImmediate(() => {
      processGreenApiWebhook(rawBuffer, greenInstanceDbId).catch((err) => {
        console.error('[Webhook] Parse or process error:', err.message);
      });
    });
  },
);

// Fallback: POST without /:id — try instanceData.idInstance from body → DB row (enables replies if Green API URL is wrong)
app.post(
  '/api/webhook/greenapi',
  express.raw({ type: '*/*', limit: '5mb' }),
  (req, res) => {
    (async () => {
      let body = null;
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        try {
          body = JSON.parse(req.body.toString('utf8'));
        } catch (_) {
          /* handled below */
        }
      }
      try {
        const dbInstanceId = await resolveGreenInstanceDbIdFromWebhookBody(body);
        if (dbInstanceId) {
          console.warn(
            '[Webhook] FALLBACK: URL had no /:id; routed using Green API instanceData.idInstance → DB id',
            dbInstanceId,
          );
          console.warn(
            `[Webhook] Prefer configuring Green API to: POST .../api/webhook/greenapi/${dbInstanceId} (explicit instance).`,
          );
          res.sendStatus(200);
          setImmediate(() => {
            processGreenApiWebhook(req.body, dbInstanceId).catch((err) => {
              console.error('[Webhook] Parse or process error:', err.message);
            });
          });
          return;
        }
      } catch (e) {
        console.error('[Webhook] Fallback resolution error:', e.message);
      }

      console.warn('[Webhook] MISCONFIGURED: received POST /api/webhook/greenapi without instance id in the path.');
      console.warn(
        '[Webhook] Green API must call: POST /api/webhook/greenapi/<green-instance-id> (copy id from Settings → webhook path).',
      );
      console.warn(
        '[Webhook] Or ensure webhook JSON includes instanceData.idInstance matching your saved Green API instance ID.',
      );
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        console.warn('[Webhook] Body preview (first 200 chars):', req.body.toString('utf8').slice(0, 200));
      }
      res.status(410).json({
        error:
          'Configure Green API webhook URL as POST /api/webhook/greenapi/<id> where <id> is your Green instance id from Settings.',
      });
    })().catch((e) => {
      console.error('[Webhook] Unhandled fallback error:', e);
      if (!res.headersSent) res.status(500).json({ error: 'Webhook handler error' });
    });
  },
);

app.use(express.json({ limit: '5mb' }));

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(
  session({
    secret: process.env.SESSION_SECRET,
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
app.use(express.static(path.join(process.cwd(), 'public')));

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

// GET /api/campaign/templates – default {{university}} / {{link}} template strings for dashboard modal
app.get('/api/campaign/templates', (req, res) => {
  res.json({ templates: defaultTemplateStrings() });
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
  const { name, phoneNumber, greenInstanceId, apiToken } = req.body || {};
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
    await pool.execute(
      'UPDATE green_instances SET name = ?, phoneNumber = ?, greenInstanceId = ?, apiToken = ? WHERE id = ?',
      [n, p, gid, tok, req.params.id],
    );
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
      },
    });
  } catch (err) {
    console.error('[Instances update]', err);
    res.status(500).json({ error: err.message || 'Update failed' });
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

// POST /api/upload – accept .xlsx, parse, return users + grouping
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const greenInstanceDbId = String(req.body?.greenInstanceId || '').trim();
    if (!greenInstanceDbId) {
      return res.status(400).json({ error: 'greenInstanceId is required (select an instance).' });
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

    const [instRows2] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [
      greenInstanceDbId,
    ]);
    const inst = instRows2[0];
    if (!inst) {
      return res.status(400).json({ error: 'Invalid greenInstanceId.' });
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
      { dryRun: !!dryRun },
    );
    res.json({
      ok: true,
      dryRun: !!dryRun,
      sentCount: users.length,
      message: dryRun
        ? `Dry run: would have sent to ${users.length} users.`
        : `Sent to ${users.length} users.`,
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

// POST /api/campaign/start – reply-driven: send only message 1 to each user
app.post('/api/campaign/start', async (req, res) => {
  const { users: bodyUsers, greenInstanceId, batchSize, delaySeconds } = req.body || {};
  if (!bodyUsers || !Array.isArray(bodyUsers) || bodyUsers.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Missing or empty users array.',
    });
  }
  const gid = String(greenInstanceId || '').trim();
  if (!gid) {
    return res.status(400).json({ ok: false, error: 'greenInstanceId is required.' });
  }
  try {
    const [campRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [gid]);
    const row = campRows[0];
    if (!row) {
      return res.status(400).json({ ok: false, error: 'Invalid greenInstanceId.' });
    }
    const greenApi = resolveGreenApiConfig(row);
    const { jobId } = createJob({
      users: bodyUsers,
      batchSize,
      delaySeconds,
    });
    runCampaignJob(jobId, bodyUsers, config, {
      greenApi,
      greenInstanceDbId: gid,
    }).catch((err) => {
      console.error('[Campaign job]', err);
    });
    res.json({ ok: true, jobId });
  } catch (err) {
    console.error('[Campaign]', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Campaign start failed.',
    });
  }
});

// GET /api/campaign/status/:jobId – in-memory campaign progress
app.get('/api/campaign/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Campaign job not found.' });
  return res.json({
    status: job.status,
    totalUsers: job.totalUsers,
    processedUsers: job.processedUsers,
    batchSize: job.batchSize,
    delaySeconds: job.delaySeconds,
    startedAt: job.startedAt,
    error: job.error || '',
  });
});

// POST /api/campaign/test-message – send message 1 only; no conversation-state read/write
app.post('/api/campaign/test-message', async (req, res) => {
  const { greenInstanceId, phone: rawPhone, sequence } = req.body || {};
  const gid = String(greenInstanceId || '').trim();
  if (!gid) {
    return res.status(200).json({ ok: false, error: 'greenInstanceId is required.' });
  }
  if (!sequence || !Array.isArray(sequence) || sequence.length < 1) {
    return res.status(200).json({ ok: false, error: 'sequence must be a non-empty array.' });
  }
  const message1 = String(sequence[0] ?? '').trim();
  if (!message1) {
    return res.status(200).json({ ok: false, error: 'Message 1 (sequence[0]) cannot be empty.' });
  }

  const normalized = normalizePhone(rawPhone, config.defaultCountryCode);
  if (!normalized || normalized.length < 10) {
    return res.status(200).json({ ok: false, error: 'Invalid phone number.' });
  }
  if (normalized.length > 15) {
    return res.status(200).json({ ok: false, error: 'Phone number is too long (E.164 max 15 digits).' });
  }

  try {
    const [tmRows] = await pool.execute('SELECT * FROM green_instances WHERE id = ? LIMIT 1', [gid]);
    const row = tmRows[0];
    if (!row) {
      return res.status(200).json({ ok: false, error: 'Invalid greenInstanceId.' });
    }
    const greenApi = resolveGreenApiConfig(row);
    const chatId = toChatId(normalized);
    await greenSendMessage(chatId, message1, greenApi);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Test message]', err);
    return res.status(200).json({
      ok: false,
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
app.get('/api/state/:phone', (req, res) => {
  const greenInstanceDbId = String(req.query.greenInstanceId || '').trim();
  if (!greenInstanceDbId) {
    return res.status(400).json({ error: 'Query greenInstanceId is required' });
  }
  const raw = req.params.phone || '';
  const phone = String(raw).replace(/\D/g, '') || raw;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  const data = state.getState(greenInstanceDbId, phone);
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
    const { phone, university, city, link } = req.body || {};
    const normalized = normalizePhone(phone, config.defaultCountryCode);
    if (!normalized)
      return res.status(400).json({ error: 'Phone is required', field: 'phone' });
    const user = {
      phone: normalized,
      university: university || '',
      city: city || '',
      link: link || '',
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
  if (state.getState(greenInstanceDbId, phone) == null) {
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
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

console.log('Starting server...');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Webhook (per instance): POST /api/webhook/greenapi/<green_instances.id>');
  try {
    const prodCount = Object.keys(state.loadState()).length;
    const testCount = Object.keys(testState.loadState()).length;
    console.log('[State] Loaded prod keys:', prodCount, '| test keys:', testCount);
  } catch (err) {
    console.error('[State ERROR]', err.message);
  }
});
