CREATE TABLE `trader_runtime_authority_assessments_v2` (
  `assessment_id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `runtime_instance_id` text NOT NULL,
  `posture` text NOT NULL CHECK (`posture` IN ('FULL_ANALYSIS_AND_NEW_RISK','NO_NEW_RISK','CLOSE_ONLY','HALT')),
  `content_digest` text NOT NULL CHECK (length(`content_digest`) = 64 AND `content_digest` NOT GLOB '*[^0-9a-f]*'),
  `canonical_json` text NOT NULL CHECK (json_valid(`canonical_json`) AND json_type(`canonical_json`) = 'object'),
  `adjudicated_at_utc` text NOT NULL,
  `created_at` integer NOT NULL,
  CHECK (`assessment_id` = 'runtime-authority-v2:' || `content_digest`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_runtime_authority_assessments_v2_org_digest_unique` ON `trader_runtime_authority_assessments_v2` (`organization_id`,`content_digest`);
--> statement-breakpoint
CREATE INDEX `trader_runtime_authority_assessments_v2_org_runtime_idx` ON `trader_runtime_authority_assessments_v2` (`organization_id`,`runtime_instance_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `trader_runtime_authority_assessments_v2_update_guard` BEFORE UPDATE ON `trader_runtime_authority_assessments_v2` BEGIN SELECT RAISE(ABORT,'RUNTIME_AUTHORITY_V2_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `trader_runtime_authority_assessments_v2_delete_guard` BEFORE DELETE ON `trader_runtime_authority_assessments_v2` BEGIN SELECT RAISE(ABORT,'RUNTIME_AUTHORITY_V2_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TABLE `trader_runtime_control_lease_heads_v2` (
  `organization_id` text PRIMARY KEY NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `runtime_instance_id` text NOT NULL,
  `lease_epoch` integer NOT NULL CHECK (`lease_epoch` > 0),
  `content_digest` text NOT NULL CHECK (length(`content_digest`) = 64 AND `content_digest` NOT GLOB '*[^0-9a-f]*'),
  `valid_until_utc` text NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trader_runtime_control_lease_epoch_history_v2` (
  `content_digest` text PRIMARY KEY NOT NULL CHECK (length(`content_digest`) = 64 AND `content_digest` NOT GLOB '*[^0-9a-f]*'),
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`) ON DELETE cascade,
  `runtime_instance_id` text NOT NULL,
  `lease_epoch` integer NOT NULL CHECK (`lease_epoch` > 0),
  `prior_content_digest` text,
  `valid_until_utc` text NOT NULL,
  `adjudicated_at_utc` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_runtime_control_lease_epoch_history_v2_org_epoch_unique` ON `trader_runtime_control_lease_epoch_history_v2` (`organization_id`,`lease_epoch`);
--> statement-breakpoint
CREATE TRIGGER `trader_runtime_control_lease_epoch_history_v2_update_guard` BEFORE UPDATE ON `trader_runtime_control_lease_epoch_history_v2` BEGIN SELECT RAISE(ABORT,'RUNTIME_CONTROL_LEASE_HISTORY_V2_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER `trader_runtime_control_lease_epoch_history_v2_delete_guard` BEFORE DELETE ON `trader_runtime_control_lease_epoch_history_v2` BEGIN SELECT RAISE(ABORT,'RUNTIME_CONTROL_LEASE_HISTORY_V2_APPEND_ONLY'); END;
