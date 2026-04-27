#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whatsapp',
  });

  const [r] = await conn.query(
    "UPDATE green_instances SET phoneNumber = '923156516171' WHERE name = 'Hanzla'",
  );
  console.log(`updated_rows=${r.affectedRows || 0}`);

  const [rows] = await conn.query('SELECT name, phoneNumber FROM green_instances ORDER BY name');
  console.log(JSON.stringify(rows, null, 2));

  await conn.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

