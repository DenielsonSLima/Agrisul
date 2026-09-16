CREATE TABLE `billing_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`client_id` text NOT NULL,
	`type_id` text NOT NULL,
	`type_name` text NOT NULL,
	`stages_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'Rascunho' NOT NULL,
	`start_date` text DEFAULT '' NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `contract_types`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "billing_contract_status" CHECK("billing_contracts"."status" in ('Rascunho','Ativo','Concluído','Cancelado'))
);
--> statement-breakpoint
CREATE INDEX `idx_billing_contracts_owner` ON `billing_contracts` (`owner_id`);