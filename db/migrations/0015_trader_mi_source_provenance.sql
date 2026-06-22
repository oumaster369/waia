CREATE TABLE `trader_mi_source` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`venue` text NOT NULL,
	`feed_kind` text NOT NULL,
	`symbol` text,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_source_id_organization_unique` ON `trader_mi_source` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_source_org_venue_feed_symbol_unique` ON `trader_mi_source` (`organization_id`,`venue`,`feed_kind`,COALESCE(`symbol`, ''));
--> statement-breakpoint
CREATE INDEX `trader_mi_source_org_status_idx` ON `trader_mi_source` (`organization_id`,`status`);
--> statement-breakpoint
CREATE TABLE `trader_mi_source_trust` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_id` text NOT NULL,
	`trust_score` text NOT NULL,
	`rationale` text NOT NULL,
	`recorded_by` text NOT NULL,
	`event_time` integer NOT NULL,
	`ingest_time` integer NOT NULL,
	`revision_of` text,
	`revision_seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`,`organization_id`) REFERENCES `trader_mi_source`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_of`,`organization_id`) REFERENCES `trader_mi_source_trust`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_source_trust_id_organization_unique` ON `trader_mi_source_trust` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_source_trust_org_source_seq_unique` ON `trader_mi_source_trust` (`organization_id`,`source_id`,`revision_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_source_trust_org_source_seq_idx` ON `trader_mi_source_trust` (`organization_id`,`source_id`,`revision_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_source_trust_org_source_event_time_idx` ON `trader_mi_source_trust` (`organization_id`,`source_id`,`event_time`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_source_trust_block_update`
BEFORE UPDATE ON `trader_mi_source_trust`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_source_trust is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_source_trust_block_delete`
BEFORE DELETE ON `trader_mi_source_trust`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_source_trust is append-only');
END;
