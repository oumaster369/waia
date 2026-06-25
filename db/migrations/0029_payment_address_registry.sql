CREATE TABLE `payment_wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`wallet_kind` text NOT NULL,
	`custody_model` text NOT NULL,
	`control_model` text NOT NULL,
	`provider_ref` text,
	`derivation_scheme` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_wallets_org_status_idx` ON `payment_wallets` (`organization_id`,`status`);
--> statement-breakpoint
CREATE TABLE `payment_address_events` (
	`id` text PRIMARY KEY NOT NULL,
	`address_id` text NOT NULL,
	`wallet_id` text,
	`organization_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`network` text NOT NULL,
	`address` text,
	`subject_module` text,
	`subject_ref` text,
	`binding_ref` text,
	`reason` text,
	`schema_version` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`prev_event_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_address_events_address_id_seq_unique` ON `payment_address_events` (`address_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `payment_address_events_org_address_idx` ON `payment_address_events` (`organization_id`,`address_id`);
--> statement-breakpoint
CREATE TABLE `payment_addresses` (
	`address_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`wallet_id` text,
	`network` text NOT NULL,
	`address` text NOT NULL,
	`status` text NOT NULL,
	`subject_module` text,
	`subject_ref` text,
	`binding_ref` text,
	`last_event_seq` integer NOT NULL,
	`last_event_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `payment_wallets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_addresses_network_address_unique` ON `payment_addresses` (`network`,`address`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_addresses_org_subject_active_unique` ON `payment_addresses` (`organization_id`,`subject_module`,`subject_ref`) WHERE `status` = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX `payment_addresses_org_status_idx` ON `payment_addresses` (`organization_id`,`status`);
--> statement-breakpoint
CREATE TRIGGER `payment_address_events_block_update`
BEFORE UPDATE ON `payment_address_events`
BEGIN
	SELECT RAISE(ABORT, 'payment_address_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_address_events_block_delete`
BEFORE DELETE ON `payment_address_events`
BEGIN
	SELECT RAISE(ABORT, 'payment_address_events is append-only');
END;
