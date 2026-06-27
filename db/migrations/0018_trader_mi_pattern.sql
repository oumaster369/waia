CREATE TABLE `trader_mi_pattern` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`pattern_kind` text NOT NULL,
	`pattern_key` text NOT NULL,
	`name` text NOT NULL,
	`schema_version` text NOT NULL,
	`definition_json` text NOT NULL,
	`definition_digest` text NOT NULL,
	`structural_signature` text NOT NULL,
	`trial_budget_max` integer NOT NULL,
	`version_seq` integer NOT NULL,
	`revision_of` text,
	`authored_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_of`,`organization_id`) REFERENCES `trader_mi_pattern`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_pattern_id_organization_unique` ON `trader_mi_pattern` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_pattern_org_key_seq_unique` ON `trader_mi_pattern` (`organization_id`,`pattern_key`,`version_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_pattern_org_kind_name_idx` ON `trader_mi_pattern` (`organization_id`,`pattern_kind`,`name`);
--> statement-breakpoint
CREATE INDEX `trader_mi_pattern_org_key_seq_idx` ON `trader_mi_pattern` (`organization_id`,`pattern_key`,`version_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_pattern_org_structural_sig_idx` ON `trader_mi_pattern` (`organization_id`,`structural_signature`);
--> statement-breakpoint
CREATE TABLE `trader_mi_pattern_lifecycle` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`pattern_id` text NOT NULL,
	`pattern_key` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`rationale` text NOT NULL,
	`recorded_by` text NOT NULL,
	`seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pattern_id`,`organization_id`) REFERENCES `trader_mi_pattern`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_pattern_lifecycle_id_organization_unique` ON `trader_mi_pattern_lifecycle` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_pattern_lifecycle_org_key_seq_unique` ON `trader_mi_pattern_lifecycle` (`organization_id`,`pattern_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_pattern_lifecycle_org_key_seq_idx` ON `trader_mi_pattern_lifecycle` (`organization_id`,`pattern_key`,`seq`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_pattern_block_update`
BEFORE UPDATE ON `trader_mi_pattern`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_pattern is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_pattern_block_delete`
BEFORE DELETE ON `trader_mi_pattern`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_pattern is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_pattern_lifecycle_block_update`
BEFORE UPDATE ON `trader_mi_pattern_lifecycle`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_pattern_lifecycle is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_pattern_lifecycle_block_delete`
BEFORE DELETE ON `trader_mi_pattern_lifecycle`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_pattern_lifecycle is append-only');
END;
