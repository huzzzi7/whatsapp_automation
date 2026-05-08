-- Safe migration: adds auth columns to green_instances if they don't already exist
-- Run once on live: mysql -u USER -pPASS DBNAME < scripts/sql/alter-green-instances-auth.sql

SET @dbname = DATABASE();

-- isActive column
SET @col1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'green_instances' AND COLUMN_NAME = 'isActive');
SET @sql1 = IF(@col1 = 0, 'ALTER TABLE green_instances ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1', 'SELECT "isActive already exists"');
PREPARE stmt FROM @sql1; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- authStatus column
SET @col2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'green_instances' AND COLUMN_NAME = 'authStatus');
SET @sql2 = IF(@col2 = 0, "ALTER TABLE green_instances ADD COLUMN authStatus VARCHAR(50) NOT NULL DEFAULT 'unknown'", 'SELECT "authStatus already exists"');
PREPARE stmt FROM @sql2; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- statusCheckedAt column
SET @col3 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'green_instances' AND COLUMN_NAME = 'statusCheckedAt');
SET @sql3 = IF(@col3 = 0, 'ALTER TABLE green_instances ADD COLUMN statusCheckedAt DATETIME NULL', 'SELECT "statusCheckedAt already exists"');
PREPARE stmt FROM @sql3; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- manualDisabled column
SET @col4 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'green_instances' AND COLUMN_NAME = 'manualDisabled');
SET @sql4 = IF(@col4 = 0, 'ALTER TABLE green_instances ADD COLUMN manualDisabled TINYINT(1) NOT NULL DEFAULT 0', 'SELECT "manualDisabled already exists"');
PREPARE stmt FROM @sql4; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index on campaign_contacts (safe — ignored if duplicate key name)
ALTER TABLE campaign_contacts ADD INDEX idx_cc_campaign_status_instance (campaign_id, first_send_status, assigned_instance_id, sort_order);
