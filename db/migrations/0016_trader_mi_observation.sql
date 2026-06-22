CREATE TABLE `trader_mi_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_id` text NOT NULL,
	`observation_kind` text NOT NULL,
	`observation_key` text NOT NULL,
	`subject_ref` text NOT NULL,
	`schema_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`event_time` integer NOT NULL,
	`ingest_time` integer NOT NULL,
	`observed_by` text NOT NULL,
	`revision_of` text,
	`revision_seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`,`organization_id`) REFERENCES `trader_mi_source`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_of`,`organization_id`) REFERENCES `trader_mi_observation`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_observation_id_organization_unique` ON `trader_mi_observation` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_observation_org_key_seq_unique` ON `trader_mi_observation` (`organization_id`,`observation_key`,`revision_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_observation_org_kind_subject_idx` ON `trader_mi_observation` (`organization_id`,`observation_kind`,`subject_ref`);
--> statement-breakpoint
CREATE INDEX `trader_mi_observation_org_key_seq_idx` ON `trader_mi_observation` (`organization_id`,`observation_key`,`revision_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_observation_org_event_time_idx` ON `trader_mi_observation` (`organization_id`,`event_time`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_observation_block_update`
BEFORE UPDATE ON `trader_mi_observation`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_observation is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_observation_block_delete`
BEFORE DELETE ON `trader_mi_observation`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_observation is append-only');
END;
