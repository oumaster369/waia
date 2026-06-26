-- AT-E12 S3-C-B: operator reconciliation workflow schema (SQLite).

ALTER TABLE `trader_settlement_reconciliation_cases` ADD `current_decision_id` text;
--> statement-breakpoint
ALTER TABLE `trader_settlement_applications` ADD `decision_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_settlement_applications_settlement_id_unique` ON `trader_settlement_applications` (`settlement_id`);
