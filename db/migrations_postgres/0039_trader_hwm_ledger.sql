CREATE TYPE "public"."hwm_entry_type" AS ENUM('BOOTSTRAP', 'RATCHET_UP', 'ROLLBACK');
--> statement-breakpoint
CREATE TABLE "trader_hwm_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"entry_type" "hwm_entry_type" NOT NULL,
	"high_water_mark" text NOT NULL,
	"previous_high_water_mark" text,
	"source_period_id" text,
	"source_invoice_id" text,
	"valuation_source" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"reason" text,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_hwm_ledger" ADD CONSTRAINT "trader_hwm_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "trader_hwm_ledger_org_account_effective_idx" ON "trader_hwm_ledger" USING btree ("organization_id","exchange_account_id","effective_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_hwm_ledger_org_account_bootstrap_unique" ON "trader_hwm_ledger" USING btree ("organization_id","exchange_account_id") WHERE "entry_type" = 'BOOTSTRAP';
