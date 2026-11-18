CREATE TABLE `retention_adoptions` (
	`token` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`model` text NOT NULL,
	`world_id` text NOT NULL
);
