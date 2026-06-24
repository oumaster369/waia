CREATE TYPE "public"."reporting_period_status" AS ENUM('OPEN', 'CLOSED');
--> statement-breakpoint
CREATE TABLE "trader_reporting_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone,
	"starting_equity" text NOT NULL,
	"ending_equity" text,
	"open_positions_snapshot_ref" text DEFAULT '' NOT NULL,
	"realized_pnl" text,
	"unrealized_pnl" text,
	"net_deposits" text DEFAULT '0' NOT NULL,
	"net_withdrawals" text DEFAULT '0' NOT NULL,
	"valuation_source" text NOT NULL,
	"starting_snapshot_at" timestamp with time zone NOT NULL,
	"ending_snapshot_at" timestamp with time zone,
	"schema_version" text NOT NULL,
	"status" "reporting_period_status" NOT NULL,
	"record_content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_reporting_periods" ADD CONSTRAINT "trader_reporting_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "trader_reporting_periods_org_account_start_idx" ON "trader_reporting_periods" USING btree ("organization_id","exchange_account_id","period_start");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_reporting_periods_org_account_open_unique" ON "trader_reporting_periods" USING btree ("organization_id","exchange_account_id") WHERE "status" = 'OPEN';
