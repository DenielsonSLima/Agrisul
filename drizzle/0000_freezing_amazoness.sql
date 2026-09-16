CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`cnpj` text DEFAULT '' NOT NULL,
	`is_primary` integer DEFAULT 0 NOT NULL,
	`api_service` text DEFAULT '' NOT NULL,
	`api_key_ciphertext` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "companies_primary_boolean" CHECK("companies"."is_primary" in (0,1))
);
--> statement-breakpoint
CREATE INDEX `idx_companies_owner` ON `companies` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_one_primary` ON `companies` (`owner_id`) WHERE "companies"."is_primary"=1;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_owner_cnpj` ON `companies` (`owner_id`,`cnpj`) WHERE "companies"."cnpj"<>'';