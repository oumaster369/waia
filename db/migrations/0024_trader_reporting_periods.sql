CREATE TABLE `trader_reporting_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer,
	`starting_equity` text NOT NULL,
	`ending_equity` text,
	`open_positions_snapshot_ref` text DEFAULT '' NOT NULL,
	`realized_pnl` text,
	`unrealized_pnl` text,
	`net_deposits` text DEFAULT '0' NOT NULL,
	`net_withdrawals` text DEFAULT '0' NOT NULL,
	`valuation_source` text NOT NULL,
	`starting_snapshot_at` integer NOT NULL,
	`ending_snapshot_at` integer,
	`schema_version` text NOT NULL,
	`status` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_reporting_periods_org_account_start_idx` ON `trader_reporting_periods` (`organization_id`,`exchange_account_id`,`period_start`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_reporting_periods_org_account_open_unique` ON `trader_reporting_periods` (`organization_id`,`exchange_account_id`) WHERE `status` = 'OPEN';
