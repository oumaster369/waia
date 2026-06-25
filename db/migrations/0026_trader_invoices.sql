CREATE TABLE `trader_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`reporting_period_id` text NOT NULL,
	`fee_artifact_digest` text NOT NULL,
	`status` text NOT NULL,
	`currency` text NOT NULL,
	`period_realized_strategy_profit` text NOT NULL,
	`cumulative_realized_strategy_profit` text NOT NULL,
	`previous_high_water_mark` text NOT NULL,
	`new_profit_above_hwm` text NOT NULL,
	`fee_rate` text NOT NULL,
	`performance_fee` text NOT NULL,
	`proposed_new_high_water_mark` text NOT NULL,
	`billable` integer NOT NULL,
	`unrealized_pnl` text,
	`realized_fill_finality` integer NOT NULL,
	`starting_equity` text NOT NULL,
	`ending_equity` text NOT NULL,
	`net_deposits` text NOT NULL,
	`net_withdrawals` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`valuation_source` text NOT NULL,
	`fee_computed_at` integer NOT NULL,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_invoices_org_account_created_idx` ON `trader_invoices` (`organization_id`,`exchange_account_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_invoices_org_account_period_unique` ON `trader_invoices` (`organization_id`,`exchange_account_id`,`reporting_period_id`);
