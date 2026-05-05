CREATE TABLE `diary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`twin_profile_id` text,
	`body_placeholder` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`twin_profile_id`) REFERENCES `twin_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scenario_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`twin_profile_id` text NOT NULL,
	`scenario_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`twin_profile_id`) REFERENCES `twin_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `twin_dialogue_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`twin_profile_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`twin_profile_id`) REFERENCES `twin_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `twin_dialogue_turns_idempotency_key_unique` ON `twin_dialogue_turns` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `twin_dialogue_turns_twin_seq_idx` ON `twin_dialogue_turns` (`twin_profile_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `twin_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `twin_profiles_user_id_unique` ON `twin_profiles` (`user_id`);--> statement-breakpoint
CREATE TABLE `twin_readiness_state` (
	`twin_profile_id` text PRIMARY KEY NOT NULL,
	`indicators_json` text NOT NULL,
	`socialization_completed` integer NOT NULL,
	`final_state_message_shown` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`twin_profile_id`) REFERENCES `twin_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_label` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`twin_profile_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`twin_profile_id`) REFERENCES `twin_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
