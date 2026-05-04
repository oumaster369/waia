CREATE TABLE `twin_repeatability_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`twin_profile_id` text NOT NULL,
	`scenario_hash` text NOT NULL,
	`pattern_type` text NOT NULL,
	`prediction_outcome` text NOT NULL,
	`verification_result` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`twin_profile_id`) REFERENCES `twin_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `twin_repeatability_records_user_created_idx` ON `twin_repeatability_records` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `twin_repeatability_records_scenario_hash_idx` ON `twin_repeatability_records` (`scenario_hash`);
--> statement-breakpoint
CREATE INDEX `twin_repeatability_records_pattern_type_idx` ON `twin_repeatability_records` (`pattern_type`);
