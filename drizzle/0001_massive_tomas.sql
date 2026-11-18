CREATE TABLE `worlds_v03` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`seed` text NOT NULL,
	`starting_era` text NOT NULL,
	`schema_version` text NOT NULL,
	`model_version` text NOT NULL,
	`year` integer NOT NULL,
	`population` real NOT NULL,
	`era` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_key` text NOT NULL,
	`previous_snapshot_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `worlds_v03_owner_updated_idx` ON `worlds_v03` (`owner_id`,`updated_at`,`id`);