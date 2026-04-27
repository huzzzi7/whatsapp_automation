-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Apr 24, 2026 at 04:20 AM
-- Server version: 8.0.30
-- PHP Version: 8.3.28

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `whatsapp`
--

-- --------------------------------------------------------

--
-- Table structure for table `campaigns`
--

CREATE TABLE `campaigns` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `green_instance_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `queue_order` int NOT NULL,
  `total_contacts` int NOT NULL DEFAULT '0',
  `sent_count` int NOT NULL DEFAULT '0',
  `failed_or_skipped_count` int NOT NULL DEFAULT '0',
  `failed_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `batch_size` int DEFAULT NULL,
  `delay_seconds` int DEFAULT NULL,
  `message_delay_seconds` int DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `started_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `scheduled_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `campaign_contacts`
--

CREATE TABLE `campaign_contacts` (
  `id` bigint UNSIGNED NOT NULL,
  `campaign_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_normalized` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload_json` longtext COLLATE utf8mb4_unicode_ci,
  `sort_order` int NOT NULL,
  `first_send_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `attempt_count` int NOT NULL DEFAULT '0',
  `last_error` text COLLATE utf8mb4_unicode_ci,
  `sent_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `campaign_logs`
--

CREATE TABLE `campaign_logs` (
  `id` varchar(50) NOT NULL,
  `clientCampaignId` varchar(255) DEFAULT NULL,
  `totalUsers` int DEFAULT NULL,
  `totalUniversities` int DEFAULT NULL,
  `universityStats` text,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `conversation_state`
--

CREATE TABLE `conversation_state` (
  `id` bigint NOT NULL,
  `green_instance_db_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_normalized` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_sent_index` int NOT NULL,
  `campaign_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sequence_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL
) ;

-- --------------------------------------------------------

--
-- Table structure for table `green_instances`
--

CREATE TABLE `green_instances` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `phoneNumber` varchar(50) DEFAULT NULL,
  `greenInstanceId` varchar(100) DEFAULT NULL,
  `apiToken` varchar(255) DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `green_instances`
--

INSERT INTO `green_instances` (`id`, `name`, `phoneNumber`, `greenInstanceId`, `apiToken`, `createdAt`, `updatedAt`) VALUES
('39beb75f-3ab3-4e1f-ba73-17241eacf69c', 'Jonny', '03123456789', '7107546745', 'fb8a5e351881464dae6e54c9542b2344fc9bfdd3c30e4d43a6', '2026-04-03 01:01:33', '2026-04-03 01:01:33'),
('bd582dfa-1ca3-469d-9c65-236a3d884203', 'bot 1', '447585900418', '7107580490', 'fdf9fdab723140d698aaea9d942b34f4c56d63874fd74e869c', '2026-04-08 12:26:42', '2026-04-08 12:26:42'),
('e3da677b-f023-487e-9883-0e9e366ee2c1', 'cammy', '447348542981', '7107583124', '5f1d48bfb6da454d83f7d3b6e76237aff63dca2471d342df89', '2026-04-10 08:23:50', '2026-04-15 09:55:33');

-- --------------------------------------------------------

--
-- Table structure for table `incoming_messages_log`
--

CREATE TABLE `incoming_messages_log` (
  `id` bigint NOT NULL,
  `green_instance_db_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider_message_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type_webhook` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_normalized` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dedupe_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `received_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sessions`
--

CREATE TABLE `sessions` (
  `session_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `expires` int UNSIGNED NOT NULL,
  `data` mediumtext COLLATE utf8mb4_bin
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `sessions`
--

INSERT INTO `sessions` (`session_id`, `expires`, `data`) VALUES
('BO2NSka9JhvhKjAjFwPK5JXwKzmngtmJ', 1776914883, '{\"cookie\":{\"originalMaxAge\":86400000,\"expires\":\"2026-04-22T04:08:30.642Z\",\"secure\":false,\"httpOnly\":true,\"path\":\"/\",\"sameSite\":\"lax\"},\"user\":{\"id\":\"8340ba3c-e036-4c44-93a4-d1169427afe4\",\"email\":\"jonny@ultimatefreshersevents.com\",\"role\":\"ADMIN\"}}');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(50) NOT NULL,
  `name` varchar(255) DEFAULT '',
  `email` varchar(255) DEFAULT NULL,
  `passwordHash` varchar(255) DEFAULT NULL,
  `role` varchar(50) DEFAULT 'USER',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `name`, `email`, `passwordHash`, `role`, `createdAt`) VALUES
('7ec507a6-97e3-41c1-aabb-5909397cc8c9', 'Bot 2', 'jonny@fresherswelcomeweek.com', '$2b$10$wOVwDGvzkX0OBey368KoTeqZGFnPGyo8RJSodUGckJLFPlKG6W/rK', 'ADMIN', '2026-04-08 11:14:37'),
('8340ba3c-e036-4c44-93a4-d1169427afe4', 'Jonny', 'jonny@ultimatefreshersevents.com', '$2b$10$as.GxUOv..vrBdMBC7MDmu2JjQalHQQe/pDe1xqvSPbdpL0NWUd7W', 'ADMIN', '2026-03-25 04:57:07');

-- --------------------------------------------------------
--
-- Phase 5 — Warm-up system tables (Anti-Ban Core)
--

CREATE TABLE IF NOT EXISTS `warmup_templates` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `template_index` int NOT NULL COMMENT 'Order of template (1-30)',
  `template_name` varchar(100) NOT NULL COMMENT 'Human label e.g. Daily Routine',
  `messages_json` longtext NOT NULL COMMENT 'JSON array of {role: A|B, text: string}',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_template_index` (`template_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `warmup_sessions` (
  `id` varchar(36) NOT NULL COMMENT 'UUID',
  `status` enum('running','completed','stopped','failed') NOT NULL DEFAULT 'running',
  `messages_per_pair` int NOT NULL DEFAULT '10' COMMENT 'Target messages per pair conversation',
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  `stopped_at` timestamp NULL DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `warmup_pairs` (
  `id` varchar(36) NOT NULL COMMENT 'UUID',
  `session_id` varchar(36) NOT NULL,
  `sender_instance_db_id` varchar(36) NOT NULL COMMENT 'green_instances.id playing A role',
  `receiver_instance_db_id` varchar(36) NOT NULL COMMENT 'green_instances.id playing B role',
  `template_id` int unsigned NOT NULL COMMENT 'warmup_templates.id used for this pair',
  `status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
  `messages_sent` int NOT NULL DEFAULT '0',
  `messages_target` int NOT NULL DEFAULT '10',
  `last_message_at` timestamp NULL DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_warmup_pairs_session` FOREIGN KEY (`session_id`) REFERENCES `warmup_sessions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `warmup_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `pair_id` varchar(36) NOT NULL,
  `session_id` varchar(36) NOT NULL,
  `sender_instance_db_id` varchar(36) NOT NULL,
  `receiver_instance_db_id` varchar(36) NOT NULL,
  `role` enum('A','B') NOT NULL COMMENT 'Which role in the template sent this',
  `message_text` text NOT NULL,
  `message_index` int NOT NULL COMMENT 'Index in template messages array',
  `status` enum('queued','sent','failed') NOT NULL DEFAULT 'queued',
  `sent_at` timestamp NULL DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pair` (`pair_id`),
  KEY `idx_session` (`session_id`),
  CONSTRAINT `fk_warmup_messages_pair` FOREIGN KEY (`pair_id`) REFERENCES `warmup_pairs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `campaigns`
--
ALTER TABLE `campaigns`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `campaign_contacts`
--
ALTER TABLE `campaign_contacts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_campaign_contacts_campaign_phone` (`campaign_id`,`phone_normalized`),
  ADD KEY `idx_campaign_contacts_campaign_status_sort` (`campaign_id`,`first_send_status`,`sort_order`);

--
-- Indexes for table `campaign_logs`
--
ALTER TABLE `campaign_logs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `conversation_state`
--
ALTER TABLE `conversation_state`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_state` (`green_instance_db_id`,`phone_normalized`),
  ADD KEY `idx_conversation_state_updated` (`green_instance_db_id`,`updated_at`);

--
-- Indexes for table `green_instances`
--
ALTER TABLE `green_instances`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `incoming_messages_log`
--
ALTER TABLE `incoming_messages_log`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_msg` (`green_instance_db_id`,`provider_message_id`,`type_webhook`),
  ADD UNIQUE KEY `uniq_dedupe` (`dedupe_key`),
  ADD KEY `idx_incoming_messages_instance_received` (`green_instance_db_id`,`received_at`);

--
-- Indexes for table `sessions`
--
ALTER TABLE `sessions`
  ADD PRIMARY KEY (`session_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `campaign_contacts`
--
ALTER TABLE `campaign_contacts`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `conversation_state`
--
ALTER TABLE `conversation_state`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `incoming_messages_log`
--
ALTER TABLE `incoming_messages_log`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `campaign_contacts`
--
ALTER TABLE `campaign_contacts`
  ADD CONSTRAINT `fk_campaign_contacts_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
