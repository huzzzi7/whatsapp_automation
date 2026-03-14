/**
 * Express server for WhatsApp automation UI.
 * Serves public/, handles POST /api/upload, POST /api/send, POST /api/campaign/start, POST /api/webhook/greenapi.
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const config = require('./config');
const { readExcelFromBuffer } = require('./src/excel');
const { buildSequence } = require('./src/messages');
const { sendAllUsers } = require('./src/send');
const { sendFirstMessageOnly, onIncomingReply } = require('./src/replyFlow');
const { parseIncomingNotification } = require('./src/receive');
const state = require('./src/state');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function testBanner() {
  console.log('=============================');
  console.log('TEST SIMULATION ACTIVE');
  console.log('=============================');
}

// Multer: single file in memory, max 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Webhook route must run before express.json() so we can read raw body and parse manually (reliability + diagnostics)
app.post('/api/webhook/greenapi', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  console.log('[Webhook] Notification received');
  console.log('[Webhook] Content-Type:', req.get('Content-Type'));
  res.sendStatus(200);

  const rawBuffer = req.body;
  setImmediate(() => {
    try {
      let body = null;
      if (Buffer.isBuffer(rawBuffer) && rawBuffer.length > 0) {
        try {
          body = JSON.parse(rawBuffer.toString('utf8'));
        } catch (e) {
          console.error('[Webhook] Failed to parse raw body');
          return;
        }
      }
      if (!body || typeof body !== 'object') {
        console.log('[Webhook] Body keys: (empty or invalid)');
        return;
      }
      console.log('[Webhook] Body keys:', Object.keys(body).join(', '));
      const parsed = parseIncomingNotification(body);
      if (!parsed || !parsed.phone) {
        console.log('[Webhook] Ignored notification type');
        console.log('[Webhook] Payload preview:', JSON.stringify(body).slice(0, 200));
        return;
      }
      console.log('[Webhook] Parsed phone:', parsed.phone);
      console.log('[Webhook] chatId received:', parsed.chatId);
      console.log('[Webhook] Triggering replyFlow for', parsed.phone);
      onIncomingReply(parsed.phone, config).catch((err) => {
        console.error('[Webhook] onIncomingReply failed:', err);
      });
    } catch (err) {
      console.error('[Webhook] Parse or process error:', err.message);
    }
  });
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/upload – accept .xlsx, parse, return users + grouping
app.post('/api/upload', upload.single('file'), (req, res) => {
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
});

// POST /api/send – scope: "all" | "university", optional university, users[], dryRun
app.post('/api/send', async (req, res) => {
  const { scope, university, users: bodyUsers, dryRun } = req.body || {};

  if (!scope || !bodyUsers || !Array.isArray(bodyUsers)) {
    return res.status(400).json({
      ok: false,
      error: 'Missing scope or users array.',
    });
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
    await sendAllUsers(users, config, { dryRun: !!dryRun });
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

// POST /api/campaign/start – reply-driven: send only message 1 to each user
app.post('/api/campaign/start', async (req, res) => {
  const { users: bodyUsers } = req.body || {};
  if (!bodyUsers || !Array.isArray(bodyUsers) || bodyUsers.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Missing or empty users array.',
    });
  }
  try {
    const { startedUsers } = await sendFirstMessageOnly(bodyUsers, config);
    res.json({ ok: true, startedUsers });
  } catch (err) {
    console.error('[Campaign]', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Campaign start failed.',
    });
  }
});

// GET /api/state – debug: current conversation state (lastSentIndex, campaignId per phone)
app.get('/api/state', (req, res) => {
  try {
    const full = state.loadState();
    const users = {};
    for (const [phone, data] of Object.entries(full)) {
      users[phone] = {
        lastSentIndex: data.lastSentIndex,
        campaignId: data.campaignId,
      };
    }
    res.json({ users });
  } catch (err) {
    console.error('[State]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/state/:phone – debug: single user state
app.get('/api/state/:phone', (req, res) => {
  const raw = req.params.phone || '';
  const phone = String(raw).replace(/\D/g, '') || raw;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  const data = state.getState(phone);
  if (data == null) return res.status(404).json({ error: 'Phone not in campaign' });
  res.json({
    phone,
    lastSentIndex: data.lastSentIndex,
    campaignId: data.campaignId,
  });
});

// --- Test simulation routes (NODE_ENV !== production only) ---
// POST /api/test/reply – simulate one reply for a phone
app.post('/api/test/reply', async (req, res) => {
  if (isProduction) return res.status(403).json({ error: 'Test routes disabled in production' });
  testBanner();
  const phone = (req.body && req.body.phone) ? String(req.body.phone).replace(/\D/g, '') : '';
  if (!phone) return res.status(400).json({ success: false, error: 'Missing phone' });
  if (state.getState(phone) == null) {
    return res.status(400).json({ success: false, error: 'phone not in campaign' });
  }
  console.log('[Test] Simulated reply for', phone);
  await onIncomingReply(phone, config);
  res.json({ success: true, phone });
});

// POST /api/test/reply-all – simulate reply for all users in state
app.post('/api/test/reply-all', async (req, res) => {
  if (isProduction) return res.status(403).json({ error: 'Test routes disabled in production' });
  testBanner();
  const full = state.loadState();
  const phones = Object.keys(full);
  console.log('[Test] Simulated replies for all active conversations');
  for (const phone of phones) {
    await onIncomingReply(phone, config);
  }
  res.json({ processedUsers: phones.length });
});

// POST /api/test/reset – clear conversation state
app.post('/api/test/reset', (req, res) => {
  if (isProduction) return res.status(403).json({ error: 'Test routes disabled in production' });
  testBanner();
  state.resetState();
  console.log('[Test] Conversation state reset');
  res.json({ status: 'state cleared' });
});

// GET /api/webhook/test – confirm ngrok/routing (no auth)
app.get('/api/webhook/test', (req, res) => {
  res.json({ status: 'webhook working' });
});

app.listen(PORT, () => {
  const count = Object.keys(state.loadState()).length;
  console.log('Server running at http://localhost:' + PORT + '/');
  console.log('Webhook endpoint: /api/webhook/greenapi');
  console.log('[State] Loaded conversations:', count);
});
