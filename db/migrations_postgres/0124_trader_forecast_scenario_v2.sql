-- DEE-527 / WP-FORECAST-V2: terminal scenario rows (7-bucket grid)

CREATE TABLE "trader_forecast_scenario_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"forecast_id" uuid NOT NULL,
	"scenario_ordinal" integer NOT NULL,
	"probability_scale8" text NOT NULL,
	"lower_bound_scale8" text NOT NULL,
	"upper_bound_scale8" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tfsv2_scenario_ordinal_check" CHECK ("scenario_ordinal" >= 0 AND "scenario_ordinal" <= 6),
	CONSTRAINT "tfsv2_content_digest_check" CHECK ("content_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_scenario_v2" ADD CONSTRAINT "tfsv2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_scenario_v2" ADD CONSTRAINT "tfsv2_bundle_org_fk" FOREIGN KEY ("bundle_id","organization_id") REFERENCES "public"."trader_forecast_bundle_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_scenario_v2" ADD CONSTRAINT "tfsv2_forecast_org_fk" FOREIGN KEY ("forecast_id","organization_id") REFERENCES "public"."trader_forecast_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tfsv2_id_organization_unique" ON "trader_forecast_scenario_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfsv2_org_forecast_scenario_uq" ON "trader_forecast_scenario_v2" USING btree ("organization_id","forecast_id","scenario_ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfsv2_org_idempotency_key_uq" ON "trader_forecast_scenario_v2" USING btree ("organization_id","idempotency_key");

CREATE OR REPLACE FUNCTION public.waia_forecast_scenario_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_scenario_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_scenario_v2_block_update ON public.trader_forecast_scenario_v2;
CREATE TRIGGER trader_forecast_scenario_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_scenario_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_scenario_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_scenario_v2_block_delete ON public.trader_forecast_scenario_v2;
CREATE TRIGGER trader_forecast_scenario_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_scenario_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_scenario_v2_block_mutation();
