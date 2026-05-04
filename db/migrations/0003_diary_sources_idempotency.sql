ALTER TABLE `diary_entries` RENAME COLUMN `body_placeholder` TO `body`;
--> statement-breakpoint
ALTER TABLE `diary_entries` ADD COLUMN `idempotency_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `diary_entries_user_idempotency_unique` ON `diary_entries` (`user_id`, `idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `diary_entries_user_created_idx` ON `diary_entries` (`user_id`, `created_at`);
--> statement-breakpoint
ALTER TABLE `scenario_answers` ADD COLUMN `idempotency_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `scenario_answers_profile_idempotency_unique` ON `scenario_answers` (`twin_profile_id`, `idempotency_key`) WHERE `idempotency_key` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `scenario_answers_profile_created_idx` ON `scenario_answers` (`twin_profile_id`, `created_at`);
