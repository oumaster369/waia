CREATE TABLE `trader_risk_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`scope_type` text DEFAULT 'organization' NOT NULL,
	`scope_ref` text DEFAULT '' NOT NULL,
	`allowed_symbols_json` text NOT NULL,
	`max_notional` text NOT NULL,
	`max_orders_per_window` integer NOT NULL,
	`window_ms` integer NOT NULL,
	`collar_bps` integer NOT NULL,
	`max_position_per_symbol` text NOT NULL,
	`max_daily_loss` text NOT NULL,
	`max_drawdown` text NOT NULL,
	`max_open_orders` integer NOT NULL,
	`max_quote_exposure` text NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_risk_limits_org_scope_unique` ON `trader_risk_limits` (`organization_id`,`scope_type`,`scope_ref`);
--> statement-breakpoint
CREATE INDEX `trader_risk_limits_org_scope_type_idx` ON `trader_risk_limits` (`organization_id`,`scope_type`);
