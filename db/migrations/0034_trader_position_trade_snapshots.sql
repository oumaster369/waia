CREATE TABLE `trader_position_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`venue` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`positions` text NOT NULL,
	`position_count` integer NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `exchange_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_position_snapshots_org_cred_synced_idx` ON `trader_position_snapshots` (`organization_id`,`credential_id`,`synced_at`);--> statement-breakpoint
CREATE INDEX `trader_position_snapshots_org_synced_idx` ON `trader_position_snapshots` (`organization_id`,`synced_at`);--> statement-breakpoint
CREATE TABLE `trader_trade_history_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`venue` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`symbol` text NOT NULL,
	`trades` text NOT NULL,
	`trade_count` integer NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `exchange_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_trade_history_snapshots_org_cred_symbol_synced_idx` ON `trader_trade_history_snapshots` (`organization_id`,`credential_id`,`symbol`,`synced_at`);--> statement-breakpoint
CREATE INDEX `trader_trade_history_snapshots_org_synced_idx` ON `trader_trade_history_snapshots` (`organization_id`,`synced_at`);
