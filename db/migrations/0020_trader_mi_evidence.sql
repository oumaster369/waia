CREATE TABLE `trader_mi_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`evidence_kind` text NOT NULL,
	`direction` text NOT NULL,
	`hypothesis_id` text NOT NULL,
	`hypothesis_key` text NOT NULL,
	`hypothesis_definition_digest` text NOT NULL,
	`measurement_refs_json` text NOT NULL,
	`observation_refs_json` text NOT NULL,
	`event_time` integer NOT NULL,
	`ingest_time` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`null_comparator_ref` text,
	`regime_context_ref` text,
	`trial_registration_ref` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hypothesis_id`,`organization_id`) REFERENCES `trader_mi_hypothesis`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `trader_mi_evidence_ingest_after_event_check` CHECK (`ingest_time` >= `event_time`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_evidence_id_organization_unique` ON `trader_mi_evidence` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_evidence_org_key_seq_unique` ON `trader_mi_evidence` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_evidence_org_hypothesis_idx` ON `trader_mi_evidence` (`organization_id`,`hypothesis_id`);
--> statement-breakpoint
CREATE INDEX `trader_mi_evidence_org_key_seq_idx` ON `trader_mi_evidence` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_evidence_org_key_event_time_idx` ON `trader_mi_evidence` (`organization_id`,`hypothesis_key`,`event_time`);
--> statement-breakpoint
CREATE INDEX `trader_mi_evidence_org_key_direction_idx` ON `trader_mi_evidence` (`organization_id`,`hypothesis_key`,`direction`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_evidence_block_update`
BEFORE UPDATE ON `trader_mi_evidence`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_evidence is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_evidence_block_delete`
BEFORE DELETE ON `trader_mi_evidence`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_evidence is append-only');
END;
