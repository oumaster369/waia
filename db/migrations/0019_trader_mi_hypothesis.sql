CREATE TABLE `trader_mi_hypothesis` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`hypothesis_kind` text NOT NULL,
	`hypothesis_key` text NOT NULL,
	`name` text NOT NULL,
	`schema_version` text NOT NULL,
	`definition_json` text NOT NULL,
	`definition_digest` text NOT NULL,
	`supersedes_json` text,
	`version_seq` integer NOT NULL,
	`revision_of` text,
	`authored_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_of`,`organization_id`) REFERENCES `trader_mi_hypothesis`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_hypothesis_id_organization_unique` ON `trader_mi_hypothesis` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_hypothesis_org_key_seq_unique` ON `trader_mi_hypothesis` (`organization_id`,`hypothesis_key`,`version_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_hypothesis_org_kind_name_idx` ON `trader_mi_hypothesis` (`organization_id`,`hypothesis_kind`,`name`);
--> statement-breakpoint
CREATE INDEX `trader_mi_hypothesis_org_key_seq_idx` ON `trader_mi_hypothesis` (`organization_id`,`hypothesis_key`,`version_seq`);
--> statement-breakpoint
CREATE TABLE `trader_mi_hypothesis_lifecycle` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`hypothesis_id` text NOT NULL,
	`hypothesis_key` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`rationale` text NOT NULL,
	`recorded_by` text NOT NULL,
	`seq` integer NOT NULL,
	`content_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hypothesis_id`,`organization_id`) REFERENCES `trader_mi_hypothesis`(`id`,`organization_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_hypothesis_lifecycle_id_organization_unique` ON `trader_mi_hypothesis_lifecycle` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_hypothesis_lifecycle_org_key_seq_unique` ON `trader_mi_hypothesis_lifecycle` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_hypothesis_lifecycle_org_key_seq_idx` ON `trader_mi_hypothesis_lifecycle` (`organization_id`,`hypothesis_key`,`seq`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_hypothesis_block_update`
BEFORE UPDATE ON `trader_mi_hypothesis`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_hypothesis is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_hypothesis_block_delete`
BEFORE DELETE ON `trader_mi_hypothesis`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_hypothesis is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_hypothesis_lifecycle_block_update`
BEFORE UPDATE ON `trader_mi_hypothesis_lifecycle`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_hypothesis_lifecycle is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_hypothesis_lifecycle_block_delete`
BEFORE DELETE ON `trader_mi_hypothesis_lifecycle`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_hypothesis_lifecycle is append-only');
END;
