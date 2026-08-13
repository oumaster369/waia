-- DEE-527 / WP-FORECAST-V2: forecast bundle v2 (append-only)

CREATE TABLE "trader_forecast_bundle_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"predictive_package_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"anchor_closed_bar_epoch_ms" bigint NOT NULL,
	"completeness_state" text NOT NULL DEFAULT 'INCOMPLETE',
	"bundle_content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tfbv2_completeness_state_check" CHECK ("completeness_state" IN ('INCOMPLETE', 'COMPLETE')),
	CONSTRAINT "tfbv2_bundle_content_digest_check" CHECK ("bundle_content_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_bundle_v2" ADD CONSTRAINT "tfbv2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_bundle_v2" ADD CONSTRAINT "tfbv2_package_org_fk" FOREIGN KEY ("predictive_package_id","organization_id") REFERENCES "public"."trader_forecast_predictive_package_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tfbv2_id_organization_unique" ON "trader_forecast_bundle_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfbv2_org_idempotency_key_uq" ON "trader_forecast_bundle_v2" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_forecast_bundle_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_bundle_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_bundle_v2_block_update ON public.trader_forecast_bundle_v2;
CREATE TRIGGER trader_forecast_bundle_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_bundle_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_bundle_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_bundle_v2_block_delete ON public.trader_forecast_bundle_v2;
CREATE TRIGGER trader_forecast_bundle_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_bundle_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_bundle_v2_block_mutation();
