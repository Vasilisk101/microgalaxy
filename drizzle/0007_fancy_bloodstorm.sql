CREATE TABLE `retention_entries` (
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_key` text NOT NULL,
	`previous_snapshot_key` text,
	`current_bytes` integer,
	`previous_bytes` integer,
	`pinned` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `model`, `world_id`)
);
--> statement-breakpoint
CREATE INDEX `retention_entries_owner_time` ON `retention_entries` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `retention_garbage` (
	`snapshot_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retention_intents` (
	`snapshot_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `retention_intents_world` ON `retention_intents` (`owner_id`,`model`,`world_id`);--> statement-breakpoint
CREATE TABLE `retention_leases` (
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL,
	`session` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `model`, `world_id`, `session`)
);
--> statement-breakpoint
CREATE TABLE `retention_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`limit_bytes` integer DEFAULT 209715200 NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retention_tombstones` (
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `model`, `world_id`)
);
