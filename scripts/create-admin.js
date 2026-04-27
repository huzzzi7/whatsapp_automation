const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../src/mysql');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

(async () => {
  const passwordHash = await bcrypt.hash('admin123', 10);

  await pool.execute('INSERT INTO users (id, email, passwordHash, role) VALUES (?, ?, ?, ?)', [
    uuidv4(),
    'jonny@ultimatefreshersevents.com',
    passwordHash,
    'ADMIN',
  ]);

  console.log('Admin created');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
