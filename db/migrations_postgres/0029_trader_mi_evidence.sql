CREATE TYPE "public"."mi_evidence_direction" AS ENUM('FOR', 'AGAINST', 'NEUTRAL');
--> statement-breakpoint
CREATE TYPE "public"."mi_evidence_kind" AS ENUM('observed');
--> statement-breakpoint
CREATE TABLE "trader_mi_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"evidence_kind" "mi_evidence_kind" NOT NULL,
	"direction" "mi_evidence_direction" NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"hypothesis_key" text NOT NULL,
	"hypothesis_definition_digest" text NOT NULL,
	"measurement_refs_json" text NOT NULL,
	"observation_refs_json" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"ingest_time" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"seq" integer NOT NULL,
	"content_digest" text NOT NULL,
	"null_comparator_ref" text,
	"regime_context_ref" text,
	"trial_registration_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_mi_evidence_ingest_after_event_check" CHECK ("ingest_time" >= "event_time")
);
--> statement-breakpoint
ALTER TABLE "trader_mi_evidence" ADD CONSTRAINT "trader_mi_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_evidence_id_organization_unique" ON "trader_mi_evidence" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "trader_mi_evidence" ADD CONSTRAINT "trader_mi_evidence_hypothesis_id_organization_id_trader_mi_hypothesis_id_organization_id_fk" FOREIGN KEY ("hypothesis_id","organization_id") REFERENCES "public"."trader_mi_hypothesis"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_evidence_org_key_seq_unique" ON "trader_mi_evidence" USING btree ("organization_id","hypothesis_key","seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_evidence_org_hypothesis_idx" ON "trader_mi_evidence" USING btree ("organization_id","hypothesis_id");
--> statement-breakpoint
CREATE INDEX "trader_mi_evidence_org_key_seq_idx" ON "trader_mi_evidence" USING btree ("organization_id","hypothesis_key","seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_evidence_org_key_event_time_idx" ON "trader_mi_evidence" USING btree ("organization_id","hypothesis_key","event_time");
--> statement-breakpoint
CREATE INDEX "trader_mi_evidence_org_key_direction_idx" ON "trader_mi_evidence" USING btree ("organization_id","hypothesis_key","direction");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_evidence_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_evidence is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_evidence_block_update ON public.trader_mi_evidence;
CREATE TRIGGER trader_mi_evidence_block_update
  BEFORE UPDATE ON public.trader_mi_evidence
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_evidence_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_evidence_block_delete ON public.trader_mi_evidence;
CREATE TRIGGER trader_mi_evidence_block_delete
  BEFORE DELETE ON public.trader_mi_evidence
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_evidence_block_mutation();
