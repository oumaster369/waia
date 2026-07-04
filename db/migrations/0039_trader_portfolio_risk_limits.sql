-- DEE-377 / M2: portfolio risk limit columns on trader_risk_limits (SQLite)

ALTER TABLE `trader_risk_limits` ADD COLUMN `max_risk_per_trade_pct` text DEFAULT '0.01' NOT NULL;--> statement-breakpoint
ALTER TABLE `trader_risk_limits` ADD COLUMN `max_portfolio_risk_pct` text DEFAULT '0.05' NOT NULL;--> statement-breakpoint
ALTER TABLE `trader_risk_limits` ADD COLUMN `max_concurrent_positions` integer DEFAULT 3 NOT NULL;
