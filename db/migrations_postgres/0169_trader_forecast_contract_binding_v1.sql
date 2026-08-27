-- DEE-746: append-only binding from an admitted predictive package to exact Forecast V2 contracts.
CREATE TABLE "trader_forecast_contract_binding_v1" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "scientific_admission_receipt_id" uuid NOT NULL,
  "scientific_admission_receipt_content_digest" text NOT NULL,
  "selected_predictive_package_content_digest" text NOT NULL,
  "input_contract_digest" text NOT NULL,
  "model_spec_digest" text NOT NULL,
  "model_artifact_digest" text NOT NULL,
  "binding_semantic_digest" text NOT NULL,
  "binding_json" text NOT NULL,
  "content_digest" text NOT NULL,
  "schema_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trader_forecast_contract_binding_v1_schema_check"
    CHECK ("schema_version" = 'waia.trader.forecast_contract_binding.v1'),
  CONSTRAINT "trader_forecast_contract_binding_v1_digest_check"
    CHECK (
      "scientific_admission_receipt_content_digest" ~ '^[0-9a-f]{64}$'
      AND "selected_predictive_package_content_digest" ~ '^[0-9a-f]{64}$'
      AND "input_contract_digest" ~ '^[0-9a-f]{64}$'
      AND "model_spec_digest" ~ '^[0-9a-f]{64}$'
      AND "model_artifact_digest" ~ '^[0-9a-f]{64}$'
      AND "binding_semantic_digest" ~ '^[0-9a-f]{64}$'
      AND "content_digest" ~ '^[0-9a-f]{64}$'
    )
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_contract_binding_v1"
  ADD CONSTRAINT "trader_forecast_contract_binding_v1_org_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_contract_binding_v1"
  ADD CONSTRAINT "trader_forecast_contract_binding_v1_receipt_same_org_fk"
  FOREIGN KEY ("scientific_admission_receipt_id", "organization_id")
  REFERENCES "public"."trader_scientific_admission_receipt_v1"("id", "organization_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tfcb_v1_org_package_uq"
  ON "trader_forecast_contract_binding_v1"
  ("organization_id", "selected_predictive_package_content_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfcb_v1_org_semantic_uq"
  ON "trader_forecast_contract_binding_v1"
  ("organization_id", "binding_semantic_digest");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_forecast_contract_binding_v1_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_contract_binding_v1 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_forecast_contract_binding_v1_block_update
  BEFORE UPDATE ON public.trader_forecast_contract_binding_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_contract_binding_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_forecast_contract_binding_v1_block_delete
  BEFORE DELETE ON public.trader_forecast_contract_binding_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_contract_binding_v1_block_mutation();
