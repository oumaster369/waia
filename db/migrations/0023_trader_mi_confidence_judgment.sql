CREATE TABLE `trader_mi_confidence_judgment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`hypothesis_id` text NOT NULL,
	`hypothesis_key` text NOT NULL,
	`hypothesis_definition_digest` text NOT NULL,
	`level` text,
	`band_low` text,
	`band_high` text,
	`confidence_scale_version` text,
	`judgment_kind` text NOT NULL,
	`review_horizon_at` integer,
	`for_citations_json` text NOT NULL,
	`event_time` integer NOT NULL,
	`ingest_time` integer NOT NULL,
	`recorded_by` text NOT NULL,
	`seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`schema_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hypothesis_id`,`organization_id`) REFERENCES `trader_mi_hypothesis`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `trader_mi_confidence_judgment_ingest_after_event_check` CHECK (`ingest_time` >= `event_time`),
	CONSTRAINT `trader_mi_confidence_judgment_kind_check` CHECK (`judgment_kind` IN ('asserted', 'insufficiency_attested')),
	CONSTRAINT `trader_mi_confidence_judgment_asserted_fields_check` CHECK (
		`judgment_kind` <> 'asserted'
		OR (
			`level` IS NOT NULL
			AND `band_low` IS NOT NULL
			AND `band_high` IS NOT NULL
			AND `confidence_scale_version` IS NOT NULL
			AND `review_horizon_at` IS NOT NULL
		)
	),
	CONSTRAINT `trader_mi_confidence_judgment_withdrawal_fields_check` CHECK (
		`judgment_kind` <> 'insufficiency_attested'
		OR (
			`level` IS NULL
			AND `band_low` IS NULL
			AND `band_high` IS NULL
			AND `confidence_scale_version` IS NULL
			AND `review_horizon_at` IS NULL
		)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_confidence_judgment_id_organization_unique` ON `trader_mi_confidence_judgment` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_confidence_judgment_org_key_seq_unique` ON `trader_mi_confidence_judgment` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_confidence_judgment_org_hypothesis_idx` ON `trader_mi_confidence_judgment` (`organization_id`,`hypothesis_id`);
--> statement-breakpoint
CREATE INDEX `trader_mi_confidence_judgment_org_key_seq_idx` ON `trader_mi_confidence_judgment` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_confidence_judgment_org_hypothesis_ingest_idx` ON `trader_mi_confidence_judgment` (`organization_id`,`hypothesis_id`,`ingest_time`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_confidence_judgment_block_update`
BEFORE UPDATE ON `trader_mi_confidence_judgment`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_confidence_judgment is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_confidence_judgment_block_delete`
BEFORE DELETE ON `trader_mi_confidence_judgment`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_confidence_judgment is append-only');
END;
