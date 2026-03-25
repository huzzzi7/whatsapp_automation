require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./mysql');

async function validateCredentials(email, password) {
  if (!email || !password) return false;

  const normalized = String(email).trim().toLowerCase();
  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [normalized]);

  if (rows.length === 0) return false;

  const user = rows[0];

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : false;
}

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { validateCredentials, requireAuth, requireAdmin };
