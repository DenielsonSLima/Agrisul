CREATE TABLE `atr_records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "atr_month_range" CHECK("atr_records"."month" between 1 and 12),
	CONSTRAINT "atr_year_range" CHECK("atr_records"."year" between 1900 and 9999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_atr_owner_year_month` ON `atr_records` (`owner_id`,`year`,`month`);