CREATE TABLE `trader_balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`venue` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`balances` text NOT NULL,
	`asset_count` integer NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `exchange_credentials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_balance_snapshots_org_cred_synced_idx` ON `trader_balance_snapshots` (`organization_id`,`credential_id`,`synced_at`);
--> statement-breakpoint
CREATE INDEX `trader_balance_snapshots_org_synced_idx` ON `trader_balance_snapshots` (`organization_id`,`synced_at`);
