require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

const user = process.env.DB_USER || 'root';
const pass = process.env.DB_PASSWORD || '';
const name = process.env.DB_NAME || 'whatsapp';
const host = process.env.DB_HOST || '127.0.0.1';
const port = process.env.DB_PORT || '3306';
const sqlFile = path.join(__dirname, 'sql', 'db-reset.sql');

const passArg = pass ? `-p${pass}` : '';
const cmd = `mysql -h${host} -P${port} -u${user} ${passArg} ${name} < "${sqlFile}"`;

console.log('[db:reset] Running DB reset...');
try {
  execSync(cmd, { stdio: 'inherit', shell: true });
  console.log('[db:reset] Done. All tables dropped and recreated.');
} catch (err) {
  console.error('[db:reset] FAILED:', err.message);
  process.exit(1);
}

