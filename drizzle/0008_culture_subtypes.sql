CREATE TABLE `culture_subtypes` (
	`id` text PRIMARY KEY NOT NULL,
	`culture_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`culture_id`) REFERENCES `cultures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_culture_subtypes_culture_name` ON `culture_subtypes` (`culture_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `cultures` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cultures_owner_name` ON `cultures` (`owner_id`,`name_key`);