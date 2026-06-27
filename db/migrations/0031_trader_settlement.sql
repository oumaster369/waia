-- AT-E12 S3-B: settlement engine schema (SQLite).

ALTER TABLE `trader_invoices` ADD COLUMN `settled_amount` text DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trader_invoices` ADD COLUMN `paid_at` integer;
--> statement-breakpoint
CREATE TABLE `trader_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`settlement_network` text,
	`settlement_tx_hash` text,
	`transfer_index` integer,
	`block_height` text,
	`asset` text,
	`on_chain_amount` text,
	`valued_amount` text,
	`valuation_currency` text,
	`valuation_basis` text,
	`outcome` text NOT NULL,
	`exception_reason` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`prev_event_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`payment_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_settlements_payment_id_unique` ON `trader_settlements` (`payment_id`);
--> statement-breakpoint
CREATE INDEX `trader_settlements_org_account_idx` ON `trader_settlements` (`organization_id`,`exchange_account_id`);
--> statement-breakpoint
CREATE INDEX `trader_settlements_outcome_idx` ON `trader_settlements` (`outcome`);
--> statement-breakpoint
CREATE TABLE `trader_settlement_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`applied_amount` text NOT NULL,
	`invoice_status_after` text NOT NULL,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `trader_settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `trader_invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_settlement_applications_settlement_idx` ON `trader_settlement_applications` (`settlement_id`);
--> statement-breakpoint
CREATE INDEX `trader_settlement_applications_invoice_idx` ON `trader_settlement_applications` (`invoice_id`);
--> statement-breakpoint
CREATE TABLE `trader_account_status` (
	`organization_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`last_event_seq` integer NOT NULL,
	`last_event_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY (`organization_id`, `exchange_account_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trader_account_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`reason` text,
	`source_payment_id` text,
	`source_invoice_id` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`prev_event_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_account_status_events_org_account_seq_unique` ON `trader_account_status_events` (`organization_id`,`exchange_account_id`,`seq`);
