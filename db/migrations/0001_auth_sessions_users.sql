CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);