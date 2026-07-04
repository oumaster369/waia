-- DEE-376 / M1: Trade lifecycle model (SQLite mirror)

CREATE TABLE `trader_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`symbol` text NOT NULL,
	`venue` text NOT NULL,
	`account_key` text NOT NULL,
	`position_side` text NOT NULL,
	`instrument_kind` text NOT NULL,
	`strategy_signal_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`strategy_version` text NOT NULL,
	`state` text NOT NULL,
	`semantics_version` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`realized_pnl` text DEFAULT '0' NOT NULL,
	`marked_pnl` text DEFAULT '0' NOT NULL,
	`hypothesis_id` text,
	`pattern_id` text,
	`risk_decision_id` text NOT NULL,
	`allocation_decision_id` text,
	`reasoning_session_id` text,
	`signal_confidence` text,
	`opening_regime` text,
	`opening_msv_id` text,
	`opening_feature_set_id` text,
	`closing_msv_id` text,
	`closing_feature_set_id` text,
	`closing_regime` text,
	`frozen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_trades_id_organization_unique` ON `trader_trades` (`id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `trader_trades_org_strategy_signal_idx` ON `trader_trades` (`organization_id`,`strategy_signal_id`);--> statement-breakpoint
CREATE INDEX `trader_trades_org_state_idx` ON `trader_trades` (`organization_id`,`state`);--> statement-breakpoint
CREATE TABLE `trader_position_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`symbol` text NOT NULL,
	`venue` text NOT NULL,
	`account_key` text NOT NULL,
	`position_side` text NOT NULL,
	`instrument_kind` text NOT NULL,
	`strategy_signal_id` text NOT NULL,
	`state` text NOT NULL,
	`open_qty` text NOT NULL,
	`remaining_qty` text NOT NULL,
	`avg_cost` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`trade_id` text NOT NULL,
	`hedge_group_id` text,
	`target_lot_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`,`organization_id`) REFERENCES `trader_trades`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_position_lots_id_organization_unique` ON `trader_position_lots` (`id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `trader_position_lots_org_state_idx` ON `trader_position_lots` (`organization_id`,`state`);--> statement-breakpoint
CREATE INDEX `trader_position_lots_org_symbol_strategy_idx` ON `trader_position_lots` (`organization_id`,`symbol`,`strategy_signal_id`);--> statement-breakpoint
CREATE TABLE `trader_trade_legs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`trade_id` text NOT NULL,
	`position_lot_id` text NOT NULL,
	`kind` text NOT NULL,
	`order_id` text NOT NULL,
	`fill_id` text,
	`synthetic_id` text,
	`quantity` text NOT NULL,
	`price` text NOT NULL,
	`fee` text DEFAULT '0' NOT NULL,
	`executed_at` integer NOT NULL,
	`leg_pnl` text DEFAULT '0' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_id`,`organization_id`) REFERENCES `trader_trades`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`position_lot_id`,`organization_id`) REFERENCES `trader_position_lots`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_trade_legs_id_organization_unique` ON `trader_trade_legs` (`id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `trader_trade_legs_org_trade_idx` ON `trader_trade_legs` (`organization_id`,`trade_id`);--> statement-breakpoint
CREATE TABLE `trader_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`phase` text NOT NULL,
	`payload` text,
	`occurred_at` integer NOT NULL,
	`research_run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_lifecycle_events_org_entity_idx` ON `trader_lifecycle_events` (`organization_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `trader_lifecycle_events_org_phase_idx` ON `trader_lifecycle_events` (`organization_id`,`phase`);
