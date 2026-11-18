CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`seed` text NOT NULL,
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
CREATE INDEX `worlds_owner_updated_idx` ON `worlds` (`owner_id`,`updated_at`);