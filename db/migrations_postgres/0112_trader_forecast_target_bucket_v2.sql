-- DEE-527 / WP-FORECAST-V2: target bucket v2 (terminal discrete grid only)

CREATE TABLE "trader_forecast_target_bucket_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_definition_id" uuid NOT NULL,
	"bucket_ordinal" integer NOT NULL,
	"bucket_label" text NOT NULL,
	"lower_bound_scale8" text NOT NULL,
	"upper_bound_scale8" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tftbv2_bucket_ordinal_check" CHECK ("bucket_ordinal" >= 0 AND "bucket_ordinal" <= 6),
	CONSTRAINT "tftbv2_content_digest_check" CHECK ("content_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_target_bucket_v2" ADD CONSTRAINT "tftbv2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_target_bucket_v2" ADD CONSTRAINT "tftbv2_target_definition_org_fk" FOREIGN KEY ("target_definition_id","organization_id") REFERENCES "public"."trader_forecast_target_definition_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tftbv2_id_organization_unique" ON "trader_forecast_target_bucket_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tftbv2_org_target_bucket_uq" ON "trader_forecast_target_bucket_v2" USING btree ("organization_id","target_definition_id","bucket_ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "tftbv2_org_idempotency_key_uq" ON "trader_forecast_target_bucket_v2" USING btree ("organization_id","idempotency_key");

CREATE OR REPLACE FUNCTION public.waia_forecast_target_bucket_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_target_bucket_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_target_bucket_v2_block_update ON public.trader_forecast_target_bucket_v2;
CREATE TRIGGER trader_forecast_target_bucket_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_target_bucket_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_target_bucket_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_target_bucket_v2_block_delete ON public.trader_forecast_target_bucket_v2;
CREATE TRIGGER trader_forecast_target_bucket_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_target_bucket_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_target_bucket_v2_block_mutation();
