-- DEE-527 / WP-FORECAST-V2: package ↔ target two-role binding

CREATE TABLE "trader_forecast_predictive_package_target_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"predictive_package_id" uuid NOT NULL,
	"target_definition_id" uuid NOT NULL,
	"target_role_id" text NOT NULL,
	"binding_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tfpptv2_target_role_check" CHECK (
		"target_role_id" IN ('TERMINAL_RETURN', 'EXECUTION_OPPORTUNITY')
	),
	CONSTRAINT "tfpptv2_binding_digest_check" CHECK ("binding_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_predictive_package_target_v2" ADD CONSTRAINT "tfpptv2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_predictive_package_target_v2" ADD CONSTRAINT "tfpptv2_package_org_fk" FOREIGN KEY ("predictive_package_id","organization_id") REFERENCES "public"."trader_forecast_predictive_package_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_predictive_package_target_v2" ADD CONSTRAINT "tfpptv2_target_definition_org_fk" FOREIGN KEY ("target_definition_id","organization_id") REFERENCES "public"."trader_forecast_target_definition_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tfpptv2_id_organization_unique" ON "trader_forecast_predictive_package_target_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfpptv2_org_package_role_uq" ON "trader_forecast_predictive_package_target_v2" USING btree ("organization_id","predictive_package_id","target_role_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfpptv2_org_idempotency_key_uq" ON "trader_forecast_predictive_package_target_v2" USING btree ("organization_id","idempotency_key");

CREATE OR REPLACE FUNCTION public.waia_forecast_predictive_package_target_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_predictive_package_target_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_predictive_package_target_v2_block_update ON public.trader_forecast_predictive_package_target_v2;
CREATE TRIGGER trader_forecast_predictive_package_target_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_predictive_package_target_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_predictive_package_target_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_predictive_package_target_v2_block_delete ON public.trader_forecast_predictive_package_target_v2;
CREATE TRIGGER trader_forecast_predictive_package_target_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_predictive_package_target_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_predictive_package_target_v2_block_mutation();
