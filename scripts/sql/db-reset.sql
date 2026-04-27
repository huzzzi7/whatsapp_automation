-- ============================================================
-- db-reset.sql
-- DESTRUCTIVE: drops all tables and recreates from scratch.
-- Safe to run on any MySQL version — handles FK constraints.
-- Use for: fresh live deploys, dev resets, staging wipes.
-- Run with: npm run db:reset
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS warmup_messages;
DROP TABLE IF EXISTS warmup_pairs;
DROP TABLE IF EXISTS warmup_sessions;
DROP TABLE IF EXISTS campaign_contacts;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS followup_jobs;
DROP TABLE IF EXISTS conversation_state;
DROP TABLE IF EXISTS incoming_messages_log;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS campaigns (
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

CREATE TABLE IF NOT EXISTS campaign_contacts (
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

CREATE TABLE IF NOT EXISTS conversation_state (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  green_instance_db_id VARCHAR(64) NOT NULL,
  phone_normalized VARCHAR(32) NOT NULL,
  last_sent_index INT NOT NULL,
  campaign_id VARCHAR(255) NULL,
  sequence_json LONGTEXT NOT NULL,
  status VARCHAR(32) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_outbound_at DATETIME(3) NULL,
  last_inbound_at DATETIME(3) NULL,
  followup_step INT NOT NULL DEFAULT 0,
  followup_next_at DATETIME(3) NULL,
  followup_cancelled TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_state (green_instance_db_id, phone_normalized),
  KEY idx_conversation_state_updated (green_instance_db_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS followup_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  green_instance_db_id VARCHAR(64) NOT NULL,
  phone_normalized VARCHAR(32) NOT NULL,
  campaign_id VARCHAR(255) NULL,
  step INT NOT NULL,
  status ENUM('queued','sent','cancelled','failed') NOT NULL DEFAULT 'queued',
  due_at DATETIME(3) NOT NULL,
  enqueued_at DATETIME(3) NULL,
  sent_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  last_error TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_followup_due (status, due_at),
  KEY idx_followup_instance_phone (green_instance_db_id, phone_normalized),
  UNIQUE KEY uniq_followup_active (green_instance_db_id, phone_normalized, step, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warmup_sessions (
  id VARCHAR(36) PRIMARY KEY,
  status ENUM('running','completed','stopped','failed') NOT NULL DEFAULT 'running',
  messages_per_pair INT NOT NULL DEFAULT 10,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  stopped_at TIMESTAMP NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warmup_pairs (
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
  CONSTRAINT fk_warmup_pairs_session
    FOREIGN KEY (session_id) REFERENCES warmup_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warmup_messages (
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
  CONSTRAINT fk_warmup_messages_pair
    FOREIGN KEY (pair_id) REFERENCES warmup_pairs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
