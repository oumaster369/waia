CREATE TABLE `payment_watcher_checkpoints` (
	`network` text PRIMARY KEY NOT NULL,
	`last_scanned_block` text NOT NULL,
	`last_scanned_at` integer NOT NULL,
	`lease_until` integer,
	`last_error` text,
	`last_error_at` integer,
	`cycle_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
