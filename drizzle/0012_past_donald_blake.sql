CREATE TABLE `retention_notices` (
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL,
	`name` text NOT NULL,
	`bytes` integer,
	`deleted_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `model`, `world_id`)
);
