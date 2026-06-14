CREATE TYPE "public"."risk_limits_scope_type" AS ENUM('organization', 'venue', 'strategy');
--> statement-breakpoint
CREATE TABLE "trader_risk_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" "risk_limits_scope_type" DEFAULT 'organization' NOT NULL,
	"scope_ref" text DEFAULT '' NOT NULL,
	"allowed_symbols_json" text NOT NULL,
	"max_notional" text NOT NULL,
	"max_orders_per_window" integer NOT NULL,
	"window_ms" integer NOT NULL,
	"collar_bps" integer NOT NULL,
	"max_position_per_symbol" text NOT NULL,
	"max_daily_loss" text NOT NULL,
	"max_drawdown" text NOT NULL,
	"max_open_orders" integer NOT NULL,
	"max_quote_exposure" text NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_risk_limits" ADD CONSTRAINT "trader_risk_limits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trader_risk_limits_org_scope_unique" ON "trader_risk_limits" USING btree ("organization_id","scope_type","scope_ref");--> statement-breakpoint
CREATE INDEX "trader_risk_limits_org_scope_type_idx" ON "trader_risk_limits" USING btree ("organization_id","scope_type");
