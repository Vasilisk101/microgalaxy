CREATE TABLE `retention_legacy_guards` (
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `model`, `world_id`)
);
