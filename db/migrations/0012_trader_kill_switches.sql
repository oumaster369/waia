CREATE TABLE `trader_kill_switches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`scope_type` text NOT NULL,
	`scope_ref` text DEFAULT '' NOT NULL,
	`switch_type` text NOT NULL,
	`enforcement_mode` text NOT NULL,
	`state` text NOT NULL,
	`origin` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`clearing_started_at` integer,
	`cooling_off_ms` integer,
	`tripped_at` integer,
	`cleared_at` integer,
	`state_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trader_kill_switches_org_scope_state_idx` ON `trader_kill_switches` (`organization_id`,`scope_type`,`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_kill_switches_org_scope_unique` ON `trader_kill_switches` (`organization_id`,`scope_type`,`scope_ref`,`switch_type`) WHERE `organization_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_kill_switches_platform_scope_unique` ON `trader_kill_switches` (`scope_type`,`scope_ref`,`switch_type`) WHERE `organization_id` IS NULL;
