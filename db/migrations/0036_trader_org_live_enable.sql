-- DEE-212 / BP-7: org-level live-enable governance (projection + append-only events).

CREATE TABLE `trader_org_live_enable` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'DISABLED' NOT NULL,
	`max_notional_cap` text NOT NULL,
	`requested_at` integer,
	`cooling_off_ends_at` integer,
	`enabled_at` integer,
	`disabled_at` integer,
	`operator_ack_phrase_hash` text,
	`state_version` integer DEFAULT 1 NOT NULL,
	`last_event_seq` integer DEFAULT 0 NOT NULL,
	`last_event_digest` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trader_org_live_enable_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`max_notional_cap` text,
	`reason` text,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`prev_event_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_org_live_enable_events_org_seq_unique` ON `trader_org_live_enable_events` (`organization_id`,`seq`);
--> statement-breakpoint
CREATE TRIGGER trader_org_live_enable_events_block_update
BEFORE UPDATE ON trader_org_live_enable_events
BEGIN
	SELECT RAISE(ABORT, 'trader_org_live_enable_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER trader_org_live_enable_events_block_delete
BEFORE DELETE ON trader_org_live_enable_events
BEGIN
	SELECT RAISE(ABORT, 'trader_org_live_enable_events is append-only');
END;
