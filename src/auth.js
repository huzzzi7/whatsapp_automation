require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('./db');

async function validateCredentials(email, password) {
  if (!email || !password) return false;

  const user = await prisma.user.findUnique({
    where: { email: String(email).trim().toLowerCase() },
  });

  if (!user) return false;

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
