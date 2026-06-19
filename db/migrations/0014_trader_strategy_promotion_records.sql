CREATE TABLE `trader_strategy_promotion_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`strategy_version` text NOT NULL,
	`git_commit_sha` text NOT NULL,
	`target_deployment_state` text NOT NULL,
	`hypothesis` text NOT NULL,
	`intended_regime` text NOT NULL,
	`cost_model_json` text NOT NULL,
	`failure_modes_json` text NOT NULL,
	`reason_code_distribution_json` text NOT NULL,
	`paper_trading_evidence_json` text NOT NULL,
	`evidence_content_digest` text NOT NULL,
	`confidence_attestation_json` text NOT NULL,
	`record_content_digest` text NOT NULL,
	`schema_version` text NOT NULL,
	`state` text NOT NULL,
	`actor_id` text,
	`requested_at` integer,
	`confirmed_at` integer,
	`cooling_off_ends_at` integer,
	`effective_at` integer,
	`cancelled_at` integer,
	`revoked_at` integer,
	`superseded_by_record_id` text,
	`state_version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`superseded_by_record_id`) REFERENCES `trader_strategy_promotion_records`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `trader_strategy_promotion_org_strategy_state_idx` ON `trader_strategy_promotion_records` (`organization_id`,`strategy_id`,`state`);
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_strategy_promotion_org_strategy_effective_unique` ON `trader_strategy_promotion_records` (`organization_id`,`strategy_id`) WHERE `state` = 'EFFECTIVE';
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_strategy_promotion_org_idempotency_unique` ON `trader_strategy_promotion_records` (`organization_id`,`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
