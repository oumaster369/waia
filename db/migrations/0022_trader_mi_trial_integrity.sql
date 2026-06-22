CREATE TABLE `trader_mi_trial_integrity_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`trial_id` text NOT NULL,
	`event_type` text NOT NULL,
	`reason_code` text,
	`rationale` text NOT NULL,
	`cause_ref` text,
	`schema_version` text NOT NULL,
	`event_time` integer NOT NULL,
	`ingest_time` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trial_id`,`organization_id`) REFERENCES `trader_mi_trial`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `trader_mi_trial_integrity_event_ingest_after_event_check` CHECK (`ingest_time` >= `event_time`),
	CONSTRAINT `trader_mi_trial_integrity_event_reason_when_invalidated_check` CHECK (`event_type` <> 'invalidated' OR `reason_code` IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_trial_integrity_event_id_organization_unique` ON `trader_mi_trial_integrity_event` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_trial_integrity_event_org_trial_seq_unique` ON `trader_mi_trial_integrity_event` (`organization_id`,`trial_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_trial_integrity_event_org_trial_seq_idx` ON `trader_mi_trial_integrity_event` (`organization_id`,`trial_id`,`seq`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_trial_integrity_event_block_update`
BEFORE UPDATE ON `trader_mi_trial_integrity_event`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_trial_integrity_event is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_trial_integrity_event_block_delete`
BEFORE DELETE ON `trader_mi_trial_integrity_event`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_trial_integrity_event is append-only');
END;
