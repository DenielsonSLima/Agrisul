CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`legal_name` text DEFAULT '' NOT NULL,
	`trade_name` text DEFAULT '' NOT NULL,
	`cnpj` text DEFAULT '' NOT NULL,
	`street` text DEFAULT '' NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`complement` text DEFAULT '' NOT NULL,
	`district` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`zip_code` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_clients_owner_cnpj` ON `clients` (`owner_id`,`cnpj`);