CREATE TABLE `admin_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`token_hash` char(64) NOT NULL,
	`csrf_token` char(64) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`expires_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_sessions_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`type` enum('discover','predict','generate') NOT NULL,
	`payload` json NOT NULL,
	`status` enum('pending','running','done','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`run_after` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`locked_at` datetime(3),
	`dedupe_key` varchar(191),
	`last_error` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_dedupe_key_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `post_species` (
	`post_id` bigint unsigned NOT NULL,
	`species_code` varchar(32) NOT NULL,
	`selected` boolean NOT NULL DEFAULT true,
	CONSTRAINT `post_species_post_id_species_code_pk` PRIMARY KEY(`post_id`,`species_code`)
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(191) NOT NULL,
	`trip_id` bigint unsigned,
	`title` varchar(255) NOT NULL,
	`markdown` mediumtext NOT NULL,
	`status` enum('draft','published') NOT NULL DEFAULT 'draft',
	`generated_at` datetime(3),
	`edited_at` datetime(3),
	`published_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `posts_id` PRIMARY KEY(`id`),
	CONSTRAINT `posts_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `posts_trip_uq` UNIQUE(`trip_id`)
);
--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`trip_id` bigint unsigned NOT NULL,
	`species_code` varchar(32) NOT NULL,
	`scientific_name` varchar(191) NOT NULL,
	`common_name` varchar(191) NOT NULL,
	`probability` double NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `predictions_id` PRIMARY KEY(`id`),
	CONSTRAINT `predictions_trip_species_uq` UNIQUE(`trip_id`,`species_code`)
);
--> statement-breakpoint
CREATE TABLE `species_info` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`species_code` varchar(32) NOT NULL,
	`scientific_name` varchar(191) NOT NULL,
	`wiki_title` varchar(255),
	`extract` text,
	`page_url` varchar(1024),
	`image_url` varchar(1024),
	`image_attribution` text,
	`image_license` varchar(191),
	`image_license_url` varchar(1024),
	`found` boolean NOT NULL DEFAULT false,
	`fetched_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `species_info_id` PRIMARY KEY(`id`),
	CONSTRAINT `species_info_code_uq` UNIQUE(`species_code`)
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_key` varchar(191) NOT NULL,
	`device_id` int NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`ended_at` datetime(3) NOT NULL,
	`position_count` int NOT NULL,
	`centroid_lat` double NOT NULL,
	`centroid_lon` double NOT NULL,
	`status` enum('discovered','predicted','generated','failed') NOT NULL DEFAULT 'discovered',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `trips_id` PRIMARY KEY(`id`),
	CONSTRAINT `trips_source_key_uq` UNIQUE(`source_key`)
);
--> statement-breakpoint
ALTER TABLE `post_species` ADD CONSTRAINT `post_species_post_id_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `predictions` ADD CONSTRAINT `predictions_trip_id_trips_id_fk` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `admin_sessions_expires_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `posts_status_published_idx` ON `posts` (`status`,`published_at`);--> statement-breakpoint
CREATE INDEX `predictions_species_idx` ON `predictions` (`species_code`);--> statement-breakpoint
CREATE INDEX `species_info_scientific_idx` ON `species_info` (`scientific_name`);--> statement-breakpoint
CREATE INDEX `trips_status_idx` ON `trips` (`status`);--> statement-breakpoint
CREATE INDEX `trips_started_at_idx` ON `trips` (`started_at`);