CREATE TYPE "public"."mi_measurement_kind" AS ENUM('feature_transform');
--> statement-breakpoint
CREATE TABLE "trader_mi_measurement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"measurement_kind" "mi_measurement_kind" NOT NULL,
	"measurement_key" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" text NOT NULL,
	"definition_json" text NOT NULL,
	"definition_digest" text NOT NULL,
	"version_seq" integer NOT NULL,
	"revision_of" uuid,
	"authored_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_mi_measurement" ADD CONSTRAINT "trader_mi_measurement_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_measurement" ADD CONSTRAINT "trader_mi_measurement_revision_of_organization_id_trader_mi_measurement_id_organization_id_fk" FOREIGN KEY ("revision_of","organization_id") REFERENCES "public"."trader_mi_measurement"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_measurement_id_organization_unique" ON "trader_mi_measurement" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_measurement_org_key_seq_unique" ON "trader_mi_measurement" USING btree ("organization_id","measurement_key","version_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_measurement_org_kind_name_idx" ON "trader_mi_measurement" USING btree ("organization_id","measurement_kind","name");
--> statement-breakpoint
CREATE INDEX "trader_mi_measurement_org_key_seq_idx" ON "trader_mi_measurement" USING btree ("organization_id","measurement_key","version_seq");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_measurement_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_measurement is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_measurement_block_update ON public.trader_mi_measurement;
CREATE TRIGGER trader_mi_measurement_block_update
  BEFORE UPDATE ON public.trader_mi_measurement
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_measurement_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_measurement_block_delete ON public.trader_mi_measurement;
CREATE TRIGGER trader_mi_measurement_block_delete
  BEFORE DELETE ON public.trader_mi_measurement
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_measurement_block_mutation();
