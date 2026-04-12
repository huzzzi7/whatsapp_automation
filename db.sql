CREATE TABLE users (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) DEFAULT '',
  email VARCHAR(255) UNIQUE,
  passwordHash VARCHAR(255),
  role VARCHAR(50) DEFAULT 'USER',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE green_instances (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255),
  phoneNumber VARCHAR(50),
  greenInstanceId VARCHAR(100),
  apiToken VARCHAR(255),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE campaign_logs (
  id VARCHAR(50) PRIMARY KEY,
  clientCampaignId VARCHAR(255),
  totalUsers INT,
  totalUniversities INT,
  universityStats TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Persistent campaign queue / execution (references green_instances.id at application level; no schema change to green_instances)
CREATE TABLE campaigns (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE campaign_contacts (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- express-mysql-session (not auto-created by default)
CREATE TABLE IF NOT EXISTS sessions (
  session_id varchar(128) COLLATE utf8mb4_bin NOT NULL,
  expires int unsigned NOT NULL,
  data mediumtext COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Existing DBs: add split counters (failed_or_skipped_count retained for legacy reads only)
-- ALTER TABLE campaigns ADD COLUMN failed_count INT NOT NULL DEFAULT 0;
-- ALTER TABLE campaigns ADD COLUMN skipped_count INT NOT NULL DEFAULT 0;
-- ALTER TABLE campaigns ADD COLUMN scheduled_at TIMESTAMP NULL DEFAULT NULL;

-- Webhook idempotency (one row per inbound message per instance)
CREATE TABLE IF NOT EXISTS incoming_messages_log (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- If upgrading an older DB without dedupe_key: run `node scripts/ensure-core-tables.js` (applies migration), or:
-- ALTER TABLE incoming_messages_log ADD COLUMN dedupe_key VARCHAR(255) NULL;
-- UPDATE incoming_messages_log SET dedupe_key = CONCAT('migrated-', LPAD(id, 20, '0')) WHERE dedupe_key IS NULL;
-- ALTER TABLE incoming_messages_log MODIFY dedupe_key VARCHAR(255) NOT NULL;
-- ALTER TABLE incoming_messages_log ADD UNIQUE KEY uniq_dedupe (dedupe_key);

-- Production conversation state (dual-write with conversation-state.json during migration)
CREATE TABLE IF NOT EXISTS conversation_state (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing DBs: ALTER TABLE conversation_state ADD COLUMN status VARCHAR(32) NULL;
