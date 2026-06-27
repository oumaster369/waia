CREATE TABLE `exchange_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`venue` text NOT NULL,
	`exchange_account_id` text NOT NULL,
	`api_key_masked` text,
	`encrypted_payload` text,
	`payload_key_version` text,
	`wrapped_dek_key_version` text,
	`wrapped_dek_key` text,
	`permission_metadata` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exchange_credentials_org_venue_account_idx` ON `exchange_credentials` (`organization_id`,`venue`,`exchange_account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_credentials_active_org_venue_account_unique` ON `exchange_credentials` (`organization_id`,`venue`,`exchange_account_id`) WHERE `status` = 'active';
