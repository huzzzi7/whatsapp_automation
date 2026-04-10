const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'whatsapp',
  waitForConnections: true,
  connectionLimit: 25,
  queueLimit: 0,
  // Bind JS Date as UTC components; pair with SET time_zone below so TIMESTAMP matches UTC_TIMESTAMP() in SQL.
  timezone: 'Z',
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) console.error('[mysql] SET time_zone failed:', err.message);
  });
});

module.exports = pool;
