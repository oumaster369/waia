CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT');
--> statement-breakpoint
CREATE TABLE "trader_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"reporting_period_id" text NOT NULL,
	"fee_artifact_digest" text NOT NULL,
	"status" "invoice_status" NOT NULL,
	"currency" text NOT NULL,
	"period_realized_strategy_profit" text NOT NULL,
	"cumulative_realized_strategy_profit" text NOT NULL,
	"previous_high_water_mark" text NOT NULL,
	"new_profit_above_hwm" text NOT NULL,
	"fee_rate" text NOT NULL,
	"performance_fee" text NOT NULL,
	"proposed_new_high_water_mark" text NOT NULL,
	"billable" boolean NOT NULL,
	"unrealized_pnl" text,
	"realized_fill_finality" boolean NOT NULL,
	"starting_equity" text NOT NULL,
	"ending_equity" text NOT NULL,
	"net_deposits" text NOT NULL,
	"net_withdrawals" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"valuation_source" text NOT NULL,
	"fee_computed_at" timestamp with time zone NOT NULL,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_invoices" ADD CONSTRAINT "trader_invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "trader_invoices_org_account_created_idx" ON "trader_invoices" USING btree ("organization_id","exchange_account_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_invoices_org_account_period_unique" ON "trader_invoices" USING btree ("organization_id","exchange_account_id","reporting_period_id");
