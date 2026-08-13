-- DEE-527 / WP-FORECAST-V2: compact forecast seal v2

CREATE TABLE "trader_forecast_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"target_role_id" text NOT NULL,
	"forecast_generation_identity_digest" text NOT NULL,
	"forecast_content_digest" text NOT NULL,
	"distribution_semantic_digest" text NOT NULL,
	"k_config_dec" integer NOT NULL,
	"m_config_dec" integer NOT NULL,
	"s_dec" integer NOT NULL,
	"schema_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tfv2_target_role_check" CHECK (
		"target_role_id" IN ('TERMINAL_RETURN', 'EXECUTION_OPPORTUNITY')
	),
	CONSTRAINT "tfv2_digest_check" CHECK (
		"forecast_generation_identity_digest" ~ '^[0-9a-f]{64}$'
		AND "forecast_content_digest" ~ '^[0-9a-f]{64}$'
		AND "distribution_semantic_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "tfv2_s_dec_check" CHECK ("s_dec" = "k_config_dec" * "m_config_dec")
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_v2" ADD CONSTRAINT "tfv2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_v2" ADD CONSTRAINT "tfv2_bundle_org_fk" FOREIGN KEY ("bundle_id","organization_id") REFERENCES "public"."trader_forecast_bundle_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tfv2_id_organization_unique" ON "trader_forecast_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfv2_org_bundle_role_uq" ON "trader_forecast_v2" USING btree ("organization_id","bundle_id","target_role_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfv2_org_idempotency_key_uq" ON "trader_forecast_v2" USING btree ("organization_id","idempotency_key");

CREATE OR REPLACE FUNCTION public.waia_forecast_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_v2_block_update ON public.trader_forecast_v2;
CREATE TRIGGER trader_forecast_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_v2_block_delete ON public.trader_forecast_v2;
CREATE TRIGGER trader_forecast_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_v2_block_mutation();
