CREATE TABLE `trader_mi_trial` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`hypothesis_id` text NOT NULL,
	`hypothesis_key` text NOT NULL,
	`hypothesis_definition_digest` text NOT NULL,
	`research_program` text,
	`event_time` integer NOT NULL,
	`ingest_time` integer NOT NULL,
	`registered_by` text NOT NULL,
	`seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hypothesis_id`,`organization_id`) REFERENCES `trader_mi_hypothesis`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `trader_mi_trial_ingest_after_event_check` CHECK (`ingest_time` >= `event_time`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_trial_id_organization_unique` ON `trader_mi_trial` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_trial_org_key_seq_unique` ON `trader_mi_trial` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_trial_org_hypothesis_idx` ON `trader_mi_trial` (`organization_id`,`hypothesis_id`);
--> statement-breakpoint
CREATE INDEX `trader_mi_trial_org_key_seq_idx` ON `trader_mi_trial` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_trial_org_key_event_time_idx` ON `trader_mi_trial` (`organization_id`,`hypothesis_key`,`event_time`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_trial_block_update`
BEFORE UPDATE ON `trader_mi_trial`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_trial is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_trial_block_delete`
BEFORE DELETE ON `trader_mi_trial`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_trial is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_evidence_trial_ref_fk_insert`
BEFORE INSERT ON `trader_mi_evidence`
WHEN NEW.`trial_registration_ref` IS NOT NULL
BEGIN
	SELECT CASE
		WHEN (
			SELECT 1 FROM `trader_mi_trial`
			WHERE `id` = NEW.`trial_registration_ref`
				AND `organization_id` = NEW.`organization_id`
		) IS NULL
		THEN RAISE(ABORT, 'trader_mi_evidence.trial_registration_ref must reference an in-org trader_mi_trial')
	END;
END;
