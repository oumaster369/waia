-- DEE-311 / AT-E11 S6: invoice issuance workflow columns + HWM ratchet guard index.

ALTER TABLE "trader_invoices" ADD COLUMN "issuance_approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "trader_invoices" ADD COLUMN "issuance_approved_by" text;
--> statement-breakpoint
ALTER TABLE "trader_invoices" ADD COLUMN "cooling_off_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "trader_invoices" ADD COLUMN "issued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "trader_invoices" ADD COLUMN "issued_by" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_hwm_ledger_source_invoice_ratchet_unique" ON "trader_hwm_ledger" USING btree ("source_invoice_id") WHERE "entry_type" = 'RATCHET_UP' AND "source_invoice_id" IS NOT NULL;
