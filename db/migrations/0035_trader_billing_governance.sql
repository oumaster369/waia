-- AT-E11 / DEE-215: billing governance — dispute projection, append-only dispute events, append-only corrections.

CREATE TABLE `trader_invoice_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`opened_by` text,
	`opened_at` integer NOT NULL,
	`resolved_at` integer,
	`resolution_reason` text,
	`last_event_seq` integer NOT NULL,
	`last_event_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `trader_invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_invoice_disputes_org_invoice_idx` ON `trader_invoice_disputes` (`organization_id`,`invoice_id`);
--> statement-breakpoint
CREATE INDEX `trader_invoice_disputes_org_status_idx` ON `trader_invoice_disputes` (`organization_id`,`status`);
--> statement-breakpoint
CREATE TABLE `trader_invoice_dispute_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`dispute_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`reason` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`prev_event_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispute_id`) REFERENCES `trader_invoice_disputes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_invoice_dispute_events_dispute_seq_unique` ON `trader_invoice_dispute_events` (`dispute_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `trader_invoice_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`dispute_id` text,
	`exchange_account_id` text NOT NULL,
	`reporting_period_id` text NOT NULL,
	`correction_type` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`restored_hwm` text NOT NULL,
	`hwm_ledger_entry_id` text NOT NULL,
	`reason` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `trader_invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dispute_id`) REFERENCES `trader_invoice_disputes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hwm_ledger_entry_id`) REFERENCES `trader_hwm_ledger`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `trader_invoice_corrections_org_invoice_idx` ON `trader_invoice_corrections` (`organization_id`,`invoice_id`);
--> statement-breakpoint
CREATE INDEX `trader_invoice_corrections_dispute_idx` ON `trader_invoice_corrections` (`dispute_id`);
--> statement-breakpoint
CREATE TRIGGER trader_invoice_dispute_events_block_update
BEFORE UPDATE ON trader_invoice_dispute_events
BEGIN
	SELECT RAISE(ABORT, 'trader_invoice_dispute_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER trader_invoice_dispute_events_block_delete
BEFORE DELETE ON trader_invoice_dispute_events
BEGIN
	SELECT RAISE(ABORT, 'trader_invoice_dispute_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER trader_invoice_corrections_block_update
BEFORE UPDATE ON trader_invoice_corrections
BEGIN
	SELECT RAISE(ABORT, 'trader_invoice_corrections is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER trader_invoice_corrections_block_delete
BEFORE DELETE ON trader_invoice_corrections
BEGIN
	SELECT RAISE(ABORT, 'trader_invoice_corrections is append-only');
END;
