/**
 * Ensures core tables exist after a partial db.sql import. Safe to re-run (IF NOT EXISTS).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const REQUIRED = [
  'users',
  'meta_config',
  'meta_templates',
  'campaigns',
  'campaign_contacts',
  'sessions',
  'opted_out_contacts',
  'inbound_messages',
  'university_links',
  'pending_university_requests',
  'conversations',
  'conversation_messages',
];

const DDL = {
  users: `CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) DEFAULT '',
  email VARCHAR(255) UNIQUE,
  passwordHash VARCHAR(255),
  role VARCHAR(50) DEFAULT 'USER',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  meta_config: `CREATE TABLE IF NOT EXISTS meta_config (
  id INT NOT NULL PRIMARY KEY,
  phoneNumberId VARCHAR(64) NOT NULL DEFAULT '',
  accessToken TEXT NOT NULL,
  displayName VARCHAR(255) NULL,
  wabaId VARCHAR(64) NULL,
  graphVersion VARCHAR(20) NULL,
  isEnabled TINYINT(1) NOT NULL DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  meta_templates: `CREATE TABLE IF NOT EXISTS meta_templates (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  language_code VARCHAR(20) NOT NULL,
  category VARCHAR(50) NULL,
  variables JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  campaigns: `CREATE TABLE IF NOT EXISTS campaigns (
  id CHAR(36) NOT NULL PRIMARY KEY,
  provider VARCHAR(20) NOT NULL DEFAULT 'meta',
  name VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL,
  queue_order INT NOT NULL,
  total_contacts INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_or_skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  batch_size INT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  scheduled_at TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  campaign_contacts: `CREATE TABLE IF NOT EXISTS campaign_contacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  phone_normalized VARCHAR(20) NOT NULL,
  payload_json LONGTEXT NULL,
  sort_order INT NOT NULL,
  first_send_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  sent_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uk_campaign_contacts_campaign_phone (campaign_id, phone_normalized),
  KEY idx_campaign_contacts_campaign_status_sort (campaign_id, first_send_status, sort_order),
  CONSTRAINT fk_campaign_contacts_campaign
    FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  sessions: `CREATE TABLE IF NOT EXISTS sessions (
  session_id varchar(128) COLLATE utf8mb4_bin NOT NULL,
  expires int unsigned NOT NULL,
  data mediumtext COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,

  opted_out_contacts: `CREATE TABLE IF NOT EXISTS opted_out_contacts (
  phone_normalized VARCHAR(20) NOT NULL PRIMARY KEY,
  opted_out_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(20) NOT NULL DEFAULT 'keyword'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  inbound_messages: `CREATE TABLE IF NOT EXISTS inbound_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meta_message_id VARCHAR(255) NULL,
  from_phone VARCHAR(20) NOT NULL,
  campaign_id CHAR(36) NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  body_text TEXT NULL,
  button_id VARCHAR(255) NULL,
  button_title VARCHAR(255) NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_inbound_messages_meta_message_id (meta_message_id),
  KEY idx_inbound_messages_from_phone (from_phone),
  KEY idx_inbound_messages_campaign_id (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  university_links: `CREATE TABLE IF NOT EXISTS university_links (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  university_name VARCHAR(255) NOT NULL,
  group_link VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_university_links_name (university_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  pending_university_requests: `CREATE TABLE IF NOT EXISTS pending_university_requests (
  phone_normalized VARCHAR(20) NOT NULL PRIMARY KEY,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  conversations: `CREATE TABLE IF NOT EXISTS conversations (
  phone_normalized VARCHAR(20) NOT NULL PRIMARY KEY,
  display_name VARCHAR(255) NULL,
  last_message_at TIMESTAMP NULL DEFAULT NULL,
  last_message_preview VARCHAR(500) NULL,
  last_seen_by_admin_at TIMESTAMP NULL DEFAULT NULL,
  last_campaign_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conversations_last_message_at (last_message_at),
  KEY idx_conversations_last_campaign_id (last_campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  conversation_messages: `CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  phone_normalized VARCHAR(20) NOT NULL,
  campaign_id CHAR(36) NULL,
  direction VARCHAR(10) NOT NULL,
  sender VARCHAR(20) NOT NULL,
  meta_message_id VARCHAR(255) NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',
  body_text TEXT NULL,
  button_id VARCHAR(255) NULL,
  button_title VARCHAR(255) NULL,
  media_path VARCHAR(500) NULL,
  media_mime_type VARCHAR(100) NULL,
  media_filename VARCHAR(255) NULL,
  media_caption TEXT NULL,
  reaction_emoji VARCHAR(20) NULL,
  reaction_target_message_id VARCHAR(255) NULL,
  admin_user_id VARCHAR(50) NULL,
  send_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_conversation_messages_meta_message_id (meta_message_id),
  KEY idx_conversation_messages_phone_created (phone_normalized, created_at),
  KEY idx_conversation_messages_campaign (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
};

async function runCoreMigrations() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whatsapp',
    multipleStatements: false,
  });

  const [tables] = await conn.query(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
  );
  const existing = new Set(tables.map((r) => r.name));
  console.log('SHOW TABLES (current):', [...existing].sort().join(', ') || '(none)');

  const order = [
    'users',
    'meta_config',
    'meta_templates',
    'campaigns',
    'campaign_contacts',
    'sessions',
    'opted_out_contacts',
    'inbound_messages',
    'university_links',
    'pending_university_requests',
    'conversations',
    'conversation_messages',
  ];
  for (const name of order) {
    if (existing.has(name)) {
      console.log(`OK: ${name} exists`);
      continue;
    }
    console.log(`CREATE missing: ${name}`);
    await conn.query(DDL[name]);
    existing.add(name);
  }

  const [after] = await conn.query(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME',
  );
  console.log('After ensure:', after.map((r) => r.name).join(', '));

  const missing = REQUIRED.filter((t) => !after.some((r) => r.name === t));
  if (missing.length) {
    console.error('Still missing:', missing.join(', '));
    await conn.end();
    process.exit(1);
  }

  console.log('All required tables present:', REQUIRED.join(', '));

  await ensureCampaignScheduleColumns(conn);
  await ensureCampaignMetaTemplateColumn(conn);
  await ensureCampaignContactsMetaDeliveryColumns(conn);
  await ensureMetaTemplatesOptOutButtonColumn(conn);
  await ensureMetaConfigSupportContactColumn(conn);
  await ensureConversationsLeadColumns(conn);

  await conn.end();
}

/** meta_templates.has_opt_out_button — verified (via Meta Graph API) presence of a Quick Reply opt-out button. */
async function ensureMetaTemplatesOptOutButtonColumn(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'meta_templates' AND COLUMN_NAME = 'has_opt_out_button'`,
    [schema],
  );
  if (Number(rows[0]?.cnt) === 0) {
    console.log('MIGRATE: meta_templates — adding has_opt_out_button column');
    await conn.query(
      'ALTER TABLE meta_templates ADD COLUMN has_opt_out_button TINYINT(1) NOT NULL DEFAULT 0',
    );
  }
}

/** meta_config.support_contact_info — human escalation contact the AI reply service offers when needed. */
async function ensureMetaConfigSupportContactColumn(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'meta_config' AND COLUMN_NAME = 'support_contact_info'`,
    [schema],
  );
  if (Number(rows[0]?.cnt) === 0) {
    console.log('MIGRATE: meta_config — adding support_contact_info column');
    await conn.query('ALTER TABLE meta_config ADD COLUMN support_contact_info TEXT NULL');
  }
}

/** conversations lead-qualification columns, set by the AI reply service. */
async function ensureConversationsLeadColumns(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const columns = [
    { name: 'lead_qualified', ddl: 'TINYINT(1) NOT NULL DEFAULT 0' },
    { name: 'confirmed_interest', ddl: 'TINYINT(1) NOT NULL DEFAULT 0' },
    { name: 'confirmed_university', ddl: 'VARCHAR(255) NULL DEFAULT NULL' },
    { name: 'qualified_at', ddl: 'TIMESTAMP NULL DEFAULT NULL' },
  ];
  for (const col of columns) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'conversations' AND COLUMN_NAME = ?`,
      [schema, col.name],
    );
    if (Number(rows[0]?.cnt) === 0) {
      console.log(`MIGRATE: conversations — adding ${col.name} column`);
      await conn.query(`ALTER TABLE conversations ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }
}

async function ensureCampaignScheduleColumns(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  async function hasColumn(table, name) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [schema, table, name],
    );
    return Number(rows[0]?.cnt) > 0;
  }

  // campaigns columns
  if (!(await hasColumn('campaigns', 'operational_start'))) {
    console.log('MIGRATE: campaigns — adding operational_start column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN operational_start TIME NULL DEFAULT NULL');
  }
  if (!(await hasColumn('campaigns', 'operational_end'))) {
    console.log('MIGRATE: campaigns — adding operational_end column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN operational_end TIME NULL DEFAULT NULL');
  }
  if (!(await hasColumn('campaigns', 'operational_days'))) {
    console.log('MIGRATE: campaigns — adding operational_days column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN operational_days VARCHAR(20) NULL DEFAULT NULL');
  }
  if (!(await hasColumn('campaigns', 'campaign_end_date'))) {
    console.log('MIGRATE: campaigns — adding campaign_end_date column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN campaign_end_date DATE NULL DEFAULT NULL');
  }
  if (!(await hasColumn('campaigns', 'campaign_start_date'))) {
    console.log('MIGRATE: campaigns — adding campaign_start_date column');
    await conn.query(
      'ALTER TABLE campaigns ADD COLUMN campaign_start_date DATE NULL DEFAULT NULL AFTER campaign_end_date',
    );
  }
  if (!(await hasColumn('campaigns', 'daily_limit_per_instance'))) {
    console.log('MIGRATE: campaigns — adding daily_limit_per_instance column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN daily_limit_per_instance INT NULL DEFAULT NULL');
  }
}

/** campaigns.meta_template_id — which registered meta_templates row a Meta campaign uses. */
async function ensureCampaignMetaTemplateColumn(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'campaigns' AND COLUMN_NAME = 'meta_template_id'`,
    [schema],
  );
  if (Number(rows[0]?.cnt) === 0) {
    console.log('MIGRATE: campaigns — adding meta_template_id column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN meta_template_id INT NULL DEFAULT NULL');
  }
}

/** campaign_contacts.meta_message_id / meta_delivery_* — real Meta delivery status (via webhook), separate from first_send_status. */
async function ensureCampaignContactsMetaDeliveryColumns(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const columns = [
    { name: 'meta_message_id', ddl: 'VARCHAR(255) NULL DEFAULT NULL' },
    { name: 'meta_delivery_status', ddl: 'VARCHAR(20) NULL DEFAULT NULL' },
    { name: 'meta_delivery_error', ddl: 'TEXT NULL DEFAULT NULL' },
    { name: 'meta_delivery_updated_at', ddl: 'TIMESTAMP NULL DEFAULT NULL' },
  ];

  for (const col of columns) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'campaign_contacts' AND COLUMN_NAME = ?`,
      [schema, col.name],
    );
    if (Number(rows[0]?.cnt) === 0) {
      console.log(`MIGRATE: campaign_contacts — adding ${col.name} column`);
      await conn.query(`ALTER TABLE campaign_contacts ADD COLUMN ${col.name} ${col.ddl}`);
    }
  }

  const [idxRows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'campaign_contacts' AND INDEX_NAME = 'idx_campaign_contacts_meta_message_id'`,
    [schema],
  );
  if (Number(idxRows[0]?.cnt) === 0) {
    console.log('MIGRATE: campaign_contacts — adding KEY idx_campaign_contacts_meta_message_id');
    await conn.query(
      'ALTER TABLE campaign_contacts ADD KEY idx_campaign_contacts_meta_message_id (meta_message_id)',
    );
  }
}

module.exports = { runCoreMigrations };

if (require.main === module) {
  runCoreMigrations().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
