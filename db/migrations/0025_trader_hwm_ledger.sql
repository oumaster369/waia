CREATE TABLE `trader_hwm_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`high_water_mark` text NOT NULL,
	`previous_high_water_mark` text,
	`source_period_id` text,
	`source_invoice_id` text,
	`valuation_source` text NOT NULL,
	`effective_at` integer NOT NULL,
	`reason` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_hwm_ledger_org_account_effective_idx` ON `trader_hwm_ledger` (`organization_id`,`exchange_account_id`,`effective_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_hwm_ledger_org_account_bootstrap_unique` ON `trader_hwm_ledger` (`organization_id`,`exchange_account_id`) WHERE `entry_type` = 'BOOTSTRAP';
