-- DEE-527 / WP-FORECAST-V2: predictive package v2 (append-only)

CREATE TABLE "trader_forecast_predictive_package_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"primary_horizon_minutes" integer NOT NULL,
	"execution_horizon_minutes" integer NOT NULL,
	"model_transform_version" text NOT NULL,
	"replica_root_family_identity_digest" text NOT NULL,
	"predictive_package_generation_identity_digest" text NOT NULL,
	"predictive_package_content_digest" text NOT NULL,
	"k_config_dec" integer NOT NULL,
	"m_config_dec" integer NOT NULL,
	"alpha_epi_config_scale8" text NOT NULL,
	"km_global_anchor_set_digest" text NOT NULL,
	"development_dataset_digest" text NOT NULL,
	"feature_version" text NOT NULL,
	"sampler_contract_version" text NOT NULL,
	"quantizer_version" text NOT NULL,
	"normalization_version_digest" text NOT NULL,
	"runtime_contract_digest" text NOT NULL,
	"package_subject_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tfppv2_k_config_check" CHECK ("k_config_dec" >= 1 AND "k_config_dec" <= 50),
	CONSTRAINT "tfppv2_m_config_check" CHECK ("m_config_dec" >= 1 AND "m_config_dec" <= 80),
	CONSTRAINT "tfppv2_digest_check" CHECK (
		"replica_root_family_identity_digest" ~ '^[0-9a-f]{64}$'
		AND "predictive_package_generation_identity_digest" ~ '^[0-9a-f]{64}$'
		AND "predictive_package_content_digest" ~ '^[0-9a-f]{64}$'
		AND "km_global_anchor_set_digest" ~ '^[0-9a-f]{64}$'
		AND "development_dataset_digest" ~ '^[0-9a-f]{64}$'
		AND "normalization_version_digest" ~ '^[0-9a-f]{64}$'
		AND "runtime_contract_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_predictive_package_v2" ADD CONSTRAINT "tfppv2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tfppv2_id_organization_unique" ON "trader_forecast_predictive_package_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfppv2_org_idempotency_key_uq" ON "trader_forecast_predictive_package_v2" USING btree ("organization_id","idempotency_key");

CREATE OR REPLACE FUNCTION public.waia_forecast_predictive_package_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_predictive_package_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_predictive_package_v2_block_update ON public.trader_forecast_predictive_package_v2;
CREATE TRIGGER trader_forecast_predictive_package_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_predictive_package_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_predictive_package_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_predictive_package_v2_block_delete ON public.trader_forecast_predictive_package_v2;
CREATE TRIGGER trader_forecast_predictive_package_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_predictive_package_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_predictive_package_v2_block_mutation();
