CREATE TABLE `twin_prediction_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`twin_profile_id` text NOT NULL,
	`prediction_id` text,
	`scenario` text NOT NULL,
	`verification` text NOT NULL,
	`correction` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`twin_profile_id`) REFERENCES `twin_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `twin_prediction_verifications_user_created_idx` ON `twin_prediction_verifications` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `twin_prediction_verifications_profile_created_idx` ON `twin_prediction_verifications` (`twin_profile_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `twin_prediction_verifications_prediction_id_nn_idx` ON `twin_prediction_verifications` (`prediction_id`) WHERE `prediction_id` IS NOT NULL;
