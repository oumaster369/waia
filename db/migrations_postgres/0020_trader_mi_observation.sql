CREATE TYPE "public"."mi_observation_kind" AS ENUM('msv_envelope');
--> statement-breakpoint
CREATE TABLE "trader_mi_observation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"observation_kind" "mi_observation_kind" NOT NULL,
	"observation_key" text NOT NULL,
	"subject_ref" text NOT NULL,
	"schema_version" text NOT NULL,
	"payload_json" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"ingest_time" timestamp with time zone NOT NULL,
	"observed_by" text NOT NULL,
	"revision_of" uuid,
	"revision_seq" integer NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_mi_observation" ADD CONSTRAINT "trader_mi_observation_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_observation" ADD CONSTRAINT "trader_mi_observation_source_id_organization_id_trader_mi_source_id_organization_id_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."trader_mi_source"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_observation_id_organization_unique" ON "trader_mi_observation" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "trader_mi_observation" ADD CONSTRAINT "trader_mi_observation_revision_of_organization_id_trader_mi_observation_id_organization_id_fk" FOREIGN KEY ("revision_of","organization_id") REFERENCES "public"."trader_mi_observation"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_observation_org_key_seq_unique" ON "trader_mi_observation" USING btree ("organization_id","observation_key","revision_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_observation_org_kind_subject_idx" ON "trader_mi_observation" USING btree ("organization_id","observation_kind","subject_ref");
--> statement-breakpoint
CREATE INDEX "trader_mi_observation_org_key_seq_idx" ON "trader_mi_observation" USING btree ("organization_id","observation_key","revision_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_observation_org_event_time_idx" ON "trader_mi_observation" USING btree ("organization_id","event_time");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_observation_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_observation is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_observation_block_update ON public.trader_mi_observation;
CREATE TRIGGER trader_mi_observation_block_update
  BEFORE UPDATE ON public.trader_mi_observation
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_observation_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_observation_block_delete ON public.trader_mi_observation;
CREATE TRIGGER trader_mi_observation_block_delete
  BEFORE DELETE ON public.trader_mi_observation
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_observation_block_mutation();
