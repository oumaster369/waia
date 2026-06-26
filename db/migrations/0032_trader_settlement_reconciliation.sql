-- AT-E12 S3-C-A: settlement exception reconciliation schema (SQLite).

CREATE TABLE `trader_settlement_reconciliation_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`exception_reason` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`priority` integer NOT NULL,
	`resolution_type` text,
	`assigned_to` text,
	`claim_expires_at` integer,
	`cooling_off_until` integer,
	`opened_at` integer NOT NULL,
	`resolved_at` integer,
	`last_event_seq` integer NOT NULL,
	`last_event_digest` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`settlement_id`) REFERENCES `trader_settlements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`payment_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_settlement_reconciliation_cases_settlement_id_unique` ON `trader_settlement_reconciliation_cases` (`settlement_id`);
--> statement-breakpoint
CREATE INDEX `trader_settlement_reconciliation_cases_org_status_priority_idx` ON `trader_settlement_reconciliation_cases` (`organization_id`,`status`,`priority`,`opened_at`);
--> statement-breakpoint
CREATE TABLE `trader_settlement_reconciliation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`payload` text NOT NULL,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`prev_event_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `trader_settlement_reconciliation_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_settlement_reconciliation_events_case_seq_unique` ON `trader_settlement_reconciliation_events` (`case_id`,`seq`);
--> statement-breakpoint
ALTER TABLE `trader_settlement_applications` ADD COLUMN `application_source` text DEFAULT 'AUTO' NOT NULL;
--> statement-breakpoint
ALTER TABLE `trader_settlement_applications` ADD COLUMN `reconciliation_case_id` text REFERENCES `trader_settlement_reconciliation_cases`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE TRIGGER trader_settlement_reconciliation_events_block_update
BEFORE UPDATE ON trader_settlement_reconciliation_events
BEGIN
	SELECT RAISE(ABORT, 'trader_settlement_reconciliation_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER trader_settlement_reconciliation_events_block_delete
BEFORE DELETE ON trader_settlement_reconciliation_events
BEGIN
	SELECT RAISE(ABORT, 'trader_settlement_reconciliation_events is append-only');
END;
