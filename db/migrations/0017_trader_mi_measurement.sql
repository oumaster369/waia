CREATE TABLE `trader_mi_measurement` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`measurement_kind` text NOT NULL,
	`measurement_key` text NOT NULL,
	`name` text NOT NULL,
	`schema_version` text NOT NULL,
	`definition_json` text NOT NULL,
	`definition_digest` text NOT NULL,
	`version_seq` integer NOT NULL,
	`revision_of` text,
	`authored_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_of`,`organization_id`) REFERENCES `trader_mi_measurement`(`id`,`organization_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_measurement_id_organization_unique` ON `trader_mi_measurement` (`id`,`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_mi_measurement_org_key_seq_unique` ON `trader_mi_measurement` (`organization_id`,`measurement_key`,`version_seq`);
--> statement-breakpoint
CREATE INDEX `trader_mi_measurement_org_kind_name_idx` ON `trader_mi_measurement` (`organization_id`,`measurement_kind`,`name`);
--> statement-breakpoint
CREATE INDEX `trader_mi_measurement_org_key_seq_idx` ON `trader_mi_measurement` (`organization_id`,`measurement_key`,`version_seq`);
--> statement-breakpoint
CREATE TRIGGER `trader_mi_measurement_block_update`
BEFORE UPDATE ON `trader_mi_measurement`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_measurement is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `trader_mi_measurement_block_delete`
BEFORE DELETE ON `trader_mi_measurement`
BEGIN
	SELECT RAISE(ABORT, 'trader_mi_measurement is append-only');
END;
