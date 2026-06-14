CREATE TABLE `trader_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`credential_id` text,
	`venue` text NOT NULL,
	`execution_mode` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`type` text NOT NULL,
	`price` text,
	`quantity` text NOT NULL,
	`filled_quantity` text DEFAULT '0' NOT NULL,
	`avg_fill_price` text,
	`state` text NOT NULL,
	`state_version` integer DEFAULT 1 NOT NULL,
	`exchange_order_id` text,
	`client_order_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`risk_decision_id` text NOT NULL,
	`strategy_signal_id` text,
	`allocation_decision_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `exchange_credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_orders_id_organization_unique` ON `trader_orders` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_orders_org_client_order_id_unique` ON `trader_orders` (`organization_id`,`client_order_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_orders_org_idempotency_key_unique` ON `trader_orders` (`organization_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `trader_orders_org_state_idx` ON `trader_orders` (`organization_id`,`state`);
--> statement-breakpoint
CREATE INDEX `trader_orders_org_execution_mode_state_idx` ON `trader_orders` (`organization_id`,`execution_mode`,`state`);
--> statement-breakpoint
CREATE INDEX `trader_orders_org_venue_symbol_idx` ON `trader_orders` (`organization_id`,`venue`,`symbol`);
--> statement-breakpoint
CREATE INDEX `trader_orders_exchange_order_id_idx` ON `trader_orders` (`exchange_order_id`);
--> statement-breakpoint
CREATE TABLE `trader_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_id` text NOT NULL,
	`seq` integer NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`,`organization_id`) REFERENCES `trader_orders`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_order_events_order_seq_unique` ON `trader_order_events` (`order_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_order_events_org_order_seq_idx` ON `trader_order_events` (`organization_id`,`order_id`,`seq`);
--> statement-breakpoint
CREATE TABLE `trader_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_id` text NOT NULL,
	`exchange_trade_id` text NOT NULL,
	`price` text NOT NULL,
	`quantity` text NOT NULL,
	`fee` text DEFAULT '0' NOT NULL,
	`fee_asset` text DEFAULT '' NOT NULL,
	`executed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`,`organization_id`) REFERENCES `trader_orders`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_fills_order_exchange_trade_id_unique` ON `trader_fills` (`order_id`,`exchange_trade_id`);
--> statement-breakpoint
CREATE INDEX `trader_fills_org_order_idx` ON `trader_fills` (`organization_id`,`order_id`);
