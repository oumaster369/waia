CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`direction` text NOT NULL,
	`subject_module` text NOT NULL,
	`subject_invoice_id` text,
	`idempotency_key` text,
	`reason` text,
	`settlement_network` text,
	`settlement_asset` text,
	`settlement_amount` text,
	`settlement_tx_hash` text,
	`transfer_index` integer,
	`confirmations_required` integer,
	`confirmations_observed` integer,
	`block_height` text,
	`observed_at` integer,
	`confirmed_at` integer,
	`valued_amount_usd` text,
	`valuation_source` text,
	`valuation_at` integer,
	`evidence_ref` text,
	`payment_address_id` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`prev_event_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_payment_id_seq_unique` ON `payment_events` (`payment_id`,`seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_org_idempotency_unique` ON `payment_events` (`organization_id`,`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_settlement_attribution_unique` ON `payment_events` (`settlement_network`,`settlement_tx_hash`,`transfer_index`) WHERE `settlement_tx_hash` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `payment_events_org_payment_idx` ON `payment_events` (`organization_id`,`payment_id`);
--> statement-breakpoint
CREATE INDEX `payment_events_subject_idx` ON `payment_events` (`subject_module`,`subject_invoice_id`);
--> statement-breakpoint
CREATE TABLE `payments` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text NOT NULL,
	`direction` text NOT NULL,
	`subject_module` text NOT NULL,
	`subject_invoice_id` text,
	`settlement_amount` text,
	`settlement_asset` text,
	`settlement_network` text,
	`settlement_tx_hash` text,
	`transfer_index` integer,
	`valued_amount_usd` text,
	`valuation_source` text,
	`last_event_seq` integer NOT NULL,
	`last_event_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payments_org_status_idx` ON `payments` (`organization_id`,`status`);
--> statement-breakpoint
CREATE INDEX `payments_subject_idx` ON `payments` (`subject_module`,`subject_invoice_id`);
--> statement-breakpoint
CREATE TRIGGER `payment_events_block_update`
BEFORE UPDATE ON `payment_events`
BEGIN
	SELECT RAISE(ABORT, 'payment_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_events_block_delete`
BEFORE DELETE ON `payment_events`
BEGIN
	SELECT RAISE(ABORT, 'payment_events is append-only');
END;
