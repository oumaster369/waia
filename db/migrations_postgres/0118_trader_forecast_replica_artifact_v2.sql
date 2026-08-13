-- DEE-527 / WP-FORECAST-V2: replica artifact v2 (bytea ≤65536)

CREATE TABLE "trader_forecast_replica_artifact_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"predictive_package_id" uuid NOT NULL,
	"replica_ordinal" integer NOT NULL,
	"bootstrap_root" bytea NOT NULL,
	"replica_artifact_digest" text NOT NULL,
	"l_block_dec" integer NOT NULL,
	"artifact_payload" bytea NOT NULL,
	"schema_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tfra2_replica_ordinal_check" CHECK ("replica_ordinal" >= 0 AND "replica_ordinal" <= 49),
	CONSTRAINT "tfra2_bootstrap_root_len_check" CHECK (octet_length("bootstrap_root") = 32),
	CONSTRAINT "tfra2_artifact_payload_len_check" CHECK (octet_length("artifact_payload") <= 65536),
	CONSTRAINT "tfra2_replica_artifact_digest_check" CHECK ("replica_artifact_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "trader_forecast_replica_artifact_v2" ADD CONSTRAINT "tfra2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_forecast_replica_artifact_v2" ADD CONSTRAINT "tfra2_package_org_fk" FOREIGN KEY ("predictive_package_id","organization_id") REFERENCES "public"."trader_forecast_predictive_package_v2"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tfra2_id_organization_unique" ON "trader_forecast_replica_artifact_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfra2_org_package_replica_uq" ON "trader_forecast_replica_artifact_v2" USING btree ("organization_id","predictive_package_id","replica_ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "tfra2_org_idempotency_key_uq" ON "trader_forecast_replica_artifact_v2" USING btree ("organization_id","idempotency_key");

CREATE OR REPLACE FUNCTION public.waia_forecast_replica_artifact_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_forecast_replica_artifact_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_replica_artifact_v2_block_update ON public.trader_forecast_replica_artifact_v2;
CREATE TRIGGER trader_forecast_replica_artifact_v2_block_update
  BEFORE UPDATE ON public.trader_forecast_replica_artifact_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_replica_artifact_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_forecast_replica_artifact_v2_block_delete ON public.trader_forecast_replica_artifact_v2;
CREATE TRIGGER trader_forecast_replica_artifact_v2_block_delete
  BEFORE DELETE ON public.trader_forecast_replica_artifact_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_forecast_replica_artifact_v2_block_mutation();
