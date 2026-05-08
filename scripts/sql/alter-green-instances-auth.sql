ALTER TABLE green_instances ADD COLUMN isActive TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE green_instances ADD COLUMN authStatus VARCHAR(50) NOT NULL DEFAULT 'unknown';
ALTER TABLE green_instances ADD COLUMN statusCheckedAt DATETIME NULL;
ALTER TABLE green_instances ADD COLUMN manualDisabled TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE campaign_contacts ADD INDEX IF NOT EXISTS idx_cc_campaign_status_instance
  (campaign_id, first_send_status, assigned_instance_id, sort_order);
