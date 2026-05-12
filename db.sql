-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Apr 27, 2026 at 06:51 AM
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
  `sequence_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `last_outbound_at` datetime(3) DEFAULT NULL,
  `last_inbound_at` datetime(3) DEFAULT NULL,
  `followup_step` int NOT NULL DEFAULT '0',
  `followup_next_at` datetime(3) DEFAULT NULL,
  `followup_cancelled` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `green_instances`
--

CREATE TABLE `green_instances` (
  `id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phoneNumber` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `greenInstanceId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `apiToken` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `green_instances`
--

INSERT INTO `green_instances` (`id`, `name`, `phoneNumber`, `greenInstanceId`, `apiToken`, `createdAt`, `updatedAt`) VALUES
('1a04fb24-dc45-4ea7-be52-6a4462845061', 'Sairs', '447348498944', '7107594794', '3c16978755d3444b94bd581df2aeb3c0ec3a692ab66d4fae96', '2026-04-27 06:49:17', '2026-04-27 06:49:17'),
('4e5fc268-3631-49b1-9918-ccf9e05bcd00', 'Lucy', '447585900418', '447585900418', 'fdf9fdab723140d698aaea9d942b34f4c56d63874fd74e869c', '2026-04-27 06:47:55', '2026-04-27 06:47:55'),
('71a91afd-76f6-428a-8344-2e35960cb445', 'hanzla', '923156516171', '7107583124', '5f1d48bfb6da454d83f7d3b6e76237aff63dca2471d342df89', '2026-04-27 06:48:15', '2026-04-27 06:48:15'),
('88461d04-64d6-4cae-8f9d-c795344303ac', 'Louise', '447348504342', '7107594796', 'bd2d3035ef354ae4ab9b5b103fd81eca152a752fa7484addbe', '2026-04-27 06:50:38', '2026-04-27 06:50:38'),
('92a3a017-16e3-4885-9c99-09a34c2246be', 'Jessica', '447348504335', '7107594795', '95912b36b7d9480b8d6db87b1cc1ae05dd065fe6a5734bf9ae', '2026-04-27 06:49:49', '2026-04-27 06:49:49'),
('ba82440c-2dcb-4cf2-b166-cae325a4cd35', 'Sara', '447919753582', '7107594831', 'd85789fe6d9d4df2878efbe25ae5304927622c040ab24dd2bc', '2026-04-27 06:51:11', '2026-04-27 06:51:11'),
('edfab5e0-ce26-40f3-be34-c88e56f924ad', 'Willow', '447348504385', '7107546745', '7107546745', '2026-04-27 06:47:31', '2026-04-27 06:47:31');

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
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int UNSIGNED NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

--
-- Dumping data for table `sessions`
--

INSERT INTO `sessions` (`session_id`, `expires`, `data`) VALUES
('9S_F5c-VsH0zGcWh68QQ8H6NQhYTp7yi', 1777359087, '{\"cookie\":{\"originalMaxAge\":86400000,\"expires\":\"2026-04-28T06:45:18.918Z\",\"secure\":false,\"httpOnly\":true,\"path\":\"/\",\"sameSite\":\"lax\"},\"user\":{\"id\":\"a9ae5f6d-4203-11f1-8d98-5820b177477f\",\"email\":\"jonny@ultimatefreshersevents.com\",\"role\":\"ADMIN\"}}');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT '',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `passwordHash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'USER',
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `name`, `email`, `passwordHash`, `role`, `createdAt`) VALUES
('a9ae5f6d-4203-11f1-8d98-5820b177477f', 'Jonny', 'jonny@ultimatefreshersevents.com', '$2b$10$tGVg/2FgzJ1/r3jUMq6IcukFwh6Z1iUWUubiDSanPbDhWICYeBGiu', 'ADMIN', '2026-04-27 11:38:12');

-- --------------------------------------------------------

--
-- Table structure for table `warmup_messages`
--

CREATE TABLE `warmup_messages` (
  `id` bigint UNSIGNED NOT NULL,
  `pair_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sender_instance_db_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `receiver_instance_db_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('A','B') COLLATE utf8mb4_unicode_ci NOT NULL,
  `message_text` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `message_index` int NOT NULL,
  `status` enum('queued','sent','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'queued',
  `sent_at` timestamp NULL DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warmup_pairs`
--

CREATE TABLE `warmup_pairs` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `session_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sender_instance_db_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `receiver_instance_db_id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_id` int UNSIGNED NOT NULL,
  `status` enum('pending','running','completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `messages_sent` int NOT NULL DEFAULT '0',
  `messages_target` int NOT NULL DEFAULT '10',
  `last_message_at` timestamp NULL DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warmup_sessions`
--

CREATE TABLE `warmup_sessions` (
  `id` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('running','completed','stopped','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'running',
  `messages_per_pair` int NOT NULL DEFAULT '10',
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  `stopped_at` timestamp NULL DEFAULT NULL,
  `error_message` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `warmup_templates`
--

CREATE TABLE `warmup_templates` (
  `id` int UNSIGNED NOT NULL,
  `template_index` int NOT NULL,
  `template_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `messages_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
-- Indexes for table `warmup_messages`
--
ALTER TABLE `warmup_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_pair` (`pair_id`),
  ADD KEY `idx_session` (`session_id`);

--
-- Indexes for table `warmup_pairs`
--
ALTER TABLE `warmup_pairs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_session` (`session_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indexes for table `warmup_sessions`
--
ALTER TABLE `warmup_sessions`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `warmup_templates`
--
ALTER TABLE `warmup_templates`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_template_index` (`template_index`);

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
-- AUTO_INCREMENT for table `warmup_messages`
--
ALTER TABLE `warmup_messages`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `warmup_templates`
--
ALTER TABLE `warmup_templates`
  MODIFY `id` int UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `campaign_contacts`
--
ALTER TABLE `campaign_contacts`
  ADD CONSTRAINT `fk_campaign_contacts_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `warmup_messages`
--
ALTER TABLE `warmup_messages`
  ADD CONSTRAINT `fk_warmup_messages_pair` FOREIGN KEY (`pair_id`) REFERENCES `warmup_pairs` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `warmup_pairs`
--
ALTER TABLE `warmup_pairs`
  ADD CONSTRAINT `fk_warmup_pairs_session` FOREIGN KEY (`session_id`) REFERENCES `warmup_sessions` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
