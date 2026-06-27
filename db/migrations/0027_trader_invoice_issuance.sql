-- DEE-311 / AT-E11 S6: invoice issuance workflow (DRAFT -> ISSUED + governance metadata).

ALTER TABLE `trader_invoices` ADD `issuance_approved_at` integer;
--> statement-breakpoint
ALTER TABLE `trader_invoices` ADD `issuance_approved_by` text;
--> statement-breakpoint
ALTER TABLE `trader_invoices` ADD `cooling_off_until` integer;
--> statement-breakpoint
ALTER TABLE `trader_invoices` ADD `issued_at` integer;
--> statement-breakpoint
ALTER TABLE `trader_invoices` ADD `issued_by` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `trader_hwm_ledger_source_invoice_ratchet_unique` ON `trader_hwm_ledger` (`source_invoice_id`) WHERE `entry_type` = 'RATCHET_UP' AND `source_invoice_id` IS NOT NULL;
