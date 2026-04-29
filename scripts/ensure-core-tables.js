/**
 * Ensures core tables exist after a partial db.sql import. Safe to re-run (IF NOT EXISTS).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const REQUIRED = [
  'users',
  'green_instances',
  'campaigns',
  'campaign_contacts',
  'sessions',
  'incoming_messages_log',
  'conversation_state',
  'warmup_templates',
  'warmup_sessions',
  'warmup_pairs',
  'warmup_messages',
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

  green_instances: `CREATE TABLE IF NOT EXISTS green_instances (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255),
  phoneNumber VARCHAR(50),
  greenInstanceId VARCHAR(100),
  apiToken VARCHAR(255),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  campaigns: `CREATE TABLE IF NOT EXISTS campaigns (
  id CHAR(36) NOT NULL PRIMARY KEY,
  green_instance_id CHAR(36) NOT NULL,
  name VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL,
  queue_order INT NOT NULL,
  total_contacts INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_or_skipped_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  batch_size INT NULL,
  delay_seconds INT NULL,
  message_delay_seconds INT NULL,
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

  incoming_messages_log: `CREATE TABLE IF NOT EXISTS incoming_messages_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  green_instance_db_id VARCHAR(64) NOT NULL,
  provider_message_id VARCHAR(255) NOT NULL,
  type_webhook VARCHAR(64) NOT NULL,
  phone_normalized VARCHAR(32) NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_msg (green_instance_db_id, provider_message_id, type_webhook),
  UNIQUE KEY uniq_dedupe (dedupe_key),
  KEY idx_incoming_messages_instance_received (green_instance_db_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  conversation_state: `CREATE TABLE IF NOT EXISTS conversation_state (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  green_instance_db_id VARCHAR(64) NOT NULL,
  phone_normalized VARCHAR(32) NOT NULL,
  last_sent_index INT NOT NULL,
  campaign_id VARCHAR(255) NULL,
  sequence_json JSON NOT NULL,
  status VARCHAR(32) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_state (green_instance_db_id, phone_normalized),
  KEY idx_conversation_state_updated (green_instance_db_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  warmup_templates: `CREATE TABLE IF NOT EXISTS warmup_templates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  template_index INT NOT NULL,
  template_name VARCHAR(100) NOT NULL,
  messages_json LONGTEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_index (template_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  warmup_sessions: `CREATE TABLE IF NOT EXISTS warmup_sessions (
  id VARCHAR(36) PRIMARY KEY,
  status ENUM('running','completed','stopped','failed') NOT NULL DEFAULT 'running',
  messages_per_pair INT NOT NULL DEFAULT 10,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  stopped_at TIMESTAMP NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  warmup_pairs: `CREATE TABLE IF NOT EXISTS warmup_pairs (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  sender_instance_db_id VARCHAR(36) NOT NULL,
  receiver_instance_db_id VARCHAR(36) NOT NULL,
  template_id INT UNSIGNED NOT NULL,
  status ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
  messages_sent INT NOT NULL DEFAULT 0,
  messages_target INT NOT NULL DEFAULT 10,
  last_message_at TIMESTAMP NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_session (session_id),
  KEY idx_status (status),
  CONSTRAINT fk_warmup_pairs_session FOREIGN KEY (session_id) REFERENCES warmup_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  warmup_messages: `CREATE TABLE IF NOT EXISTS warmup_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pair_id VARCHAR(36) NOT NULL,
  session_id VARCHAR(36) NOT NULL,
  sender_instance_db_id VARCHAR(36) NOT NULL,
  receiver_instance_db_id VARCHAR(36) NOT NULL,
  role ENUM('A','B') NOT NULL,
  message_text TEXT NOT NULL,
  message_index INT NOT NULL,
  status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  sent_at TIMESTAMP NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pair (pair_id),
  KEY idx_session (session_id),
  CONSTRAINT fk_warmup_messages_pair FOREIGN KEY (pair_id) REFERENCES warmup_pairs(id) ON DELETE CASCADE
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
    'green_instances',
    'campaigns',
    'campaign_contacts',
    'sessions',
    'incoming_messages_log',
    'conversation_state',
    'warmup_templates',
    'warmup_sessions',
    'warmup_pairs',
    'warmup_messages',
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

  await ensureIncomingMessagesDedupeKey(conn);
  await ensureConversationStateStatusColumn(conn);
  await ensureFollowupColumns(conn);
  await ensureFollowupJobsTable(conn);
  await ensureCampaignScheduleColumns(conn);
  await ensureCampaignContactsAssignmentColumn(conn);

  await conn.end();
}

/** Upgrade older incoming_messages_log rows: add dedupe_key + uniq_dedupe (keeps uniq_msg). */
async function ensureIncomingMessagesDedupeKey(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const [colRows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'incoming_messages_log' AND COLUMN_NAME = 'dedupe_key'`,
    [schema],
  );
  if (Number(colRows[0]?.cnt) === 0) {
    console.log('MIGRATE: incoming_messages_log — adding dedupe_key column');
    await conn.query('ALTER TABLE incoming_messages_log ADD COLUMN dedupe_key VARCHAR(255) NULL');
    await conn.query(
      `UPDATE incoming_messages_log SET dedupe_key = CONCAT('migrated-', LPAD(id, 20, '0')) WHERE dedupe_key IS NULL`,
    );
    await conn.query('ALTER TABLE incoming_messages_log MODIFY dedupe_key VARCHAR(255) NOT NULL');
  }

  const [idxRows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'incoming_messages_log' AND INDEX_NAME = 'uniq_dedupe'`,
    [schema],
  );
  if (Number(idxRows[0]?.cnt) === 0) {
    console.log('MIGRATE: incoming_messages_log — adding UNIQUE KEY uniq_dedupe');
    await conn.query('ALTER TABLE incoming_messages_log ADD UNIQUE KEY uniq_dedupe (dedupe_key)');
  }
}

/** Add conversation_state.status for intent / stopped tracking. */
async function ensureConversationStateStatusColumn(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const [colRows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'conversation_state' AND COLUMN_NAME = 'status'`,
    [schema],
  );
  if (Number(colRows[0]?.cnt) === 0) {
    console.log('MIGRATE: conversation_state — adding status column');
    await conn.query('ALTER TABLE conversation_state ADD COLUMN status VARCHAR(32) NULL');
  }
}

/** Add Phase 6 follow-up columns to conversation_state (idempotent). */
async function ensureFollowupColumns(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  async function hasColumn(name) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'conversation_state' AND COLUMN_NAME = ?`,
      [schema, name],
    );
    return Number(rows[0]?.cnt) > 0;
  }

  if (!(await hasColumn('last_outbound_at'))) {
    console.log('MIGRATE: conversation_state — adding last_outbound_at column');
    await conn.query('ALTER TABLE conversation_state ADD COLUMN last_outbound_at DATETIME(3) NULL');
  }

  if (!(await hasColumn('last_inbound_at'))) {
    console.log('MIGRATE: conversation_state — adding last_inbound_at column');
    await conn.query('ALTER TABLE conversation_state ADD COLUMN last_inbound_at DATETIME(3) NULL');
  }

  if (!(await hasColumn('followup_step'))) {
    console.log('MIGRATE: conversation_state — adding followup_step column');
    await conn.query('ALTER TABLE conversation_state ADD COLUMN followup_step INT NOT NULL DEFAULT 0');
  }

  if (!(await hasColumn('followup_next_at'))) {
    console.log('MIGRATE: conversation_state — adding followup_next_at column');
    await conn.query('ALTER TABLE conversation_state ADD COLUMN followup_next_at DATETIME(3) NULL');
  }

  if (!(await hasColumn('followup_cancelled'))) {
    console.log('MIGRATE: conversation_state — adding followup_cancelled column');
    await conn.query(
      'ALTER TABLE conversation_state ADD COLUMN followup_cancelled TINYINT(1) NOT NULL DEFAULT 0',
    );
  }
}

/** Ensure followup_jobs exists (Phase 6). */
async function ensureFollowupJobsTable(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS followup_jobs (
      id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      green_instance_db_id VARCHAR(64) NOT NULL,
      phone_normalized    VARCHAR(32) NOT NULL,
      campaign_id         VARCHAR(255) NULL,
      step                INT NOT NULL,
      status              ENUM('queued','sent','cancelled','failed') NOT NULL DEFAULT 'queued',
      due_at              DATETIME(3) NOT NULL,
      enqueued_at         DATETIME(3) NULL,
      sent_at             DATETIME(3) NULL,
      cancelled_at        DATETIME(3) NULL,
      last_error          TEXT NULL,
      created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                          ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_followup_due (status, due_at),
      KEY idx_followup_instance_phone (green_instance_db_id, phone_normalized),
      UNIQUE KEY uniq_followup_active (green_instance_db_id, phone_normalized, step, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
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
  if (!(await hasColumn('campaigns', 'daily_limit_per_instance'))) {
    console.log('MIGRATE: campaigns — adding daily_limit_per_instance column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN daily_limit_per_instance INT NULL DEFAULT NULL');
  }
  if (!(await hasColumn('campaigns', 'is_multi_instance'))) {
    console.log('MIGRATE: campaigns — adding is_multi_instance column');
    await conn.query('ALTER TABLE campaigns ADD COLUMN is_multi_instance TINYINT(1) NOT NULL DEFAULT 0');
  }
}

async function ensureCampaignContactsAssignmentColumn(conn) {
  const [dbRows] = await conn.query('SELECT DATABASE() AS d');
  const schema = dbRows[0]?.d;
  if (!schema) return;

  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'campaign_contacts' AND COLUMN_NAME = 'assigned_instance_id'`,
    [schema],
  );
  if (Number(rows[0]?.cnt) === 0) {
    console.log('MIGRATE: campaign_contacts — adding assigned_instance_id column');
    await conn.query(
      'ALTER TABLE campaign_contacts ADD COLUMN assigned_instance_id VARCHAR(50) NULL DEFAULT NULL',
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
