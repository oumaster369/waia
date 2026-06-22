CREATE TYPE "public"."mi_trial_integrity_event_type" AS ENUM('invalidated', 'reinstated');
--> statement-breakpoint
CREATE TYPE "public"."mi_trial_integrity_reason_code" AS ENUM('look_ahead_contamination', 'pre_registration_breach', 'computation_defect', 'provenance_gap');
--> statement-breakpoint
CREATE TABLE "trader_mi_trial_integrity_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"trial_id" uuid NOT NULL,
	"event_type" "mi_trial_integrity_event_type" NOT NULL,
	"reason_code" "mi_trial_integrity_reason_code",
	"rationale" text NOT NULL,
	"cause_ref" text,
	"schema_version" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"ingest_time" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"seq" integer NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_mi_trial_integrity_event_ingest_after_event_check" CHECK ("ingest_time" >= "event_time"),
	CONSTRAINT "trader_mi_trial_integrity_event_reason_when_invalidated_check" CHECK ("event_type" <> 'invalidated' OR "reason_code" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "trader_mi_trial_integrity_event" ADD CONSTRAINT "trader_mi_trial_integrity_event_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_trial_integrity_event" ADD CONSTRAINT "trader_mi_trial_integrity_event_trial_org_fk" FOREIGN KEY ("trial_id","organization_id") REFERENCES "public"."trader_mi_trial"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_trial_integrity_event_id_organization_unique" ON "trader_mi_trial_integrity_event" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_trial_integrity_event_org_trial_seq_unique" ON "trader_mi_trial_integrity_event" USING btree ("organization_id","trial_id","seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_trial_integrity_event_org_trial_seq_idx" ON "trader_mi_trial_integrity_event" USING btree ("organization_id","trial_id","seq");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_trial_integrity_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_trial_integrity_event is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_trial_integrity_event_block_update ON public.trader_mi_trial_integrity_event;
CREATE TRIGGER trader_mi_trial_integrity_event_block_update
  BEFORE UPDATE ON public.trader_mi_trial_integrity_event
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_trial_integrity_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_trial_integrity_event_block_delete ON public.trader_mi_trial_integrity_event;
CREATE TRIGGER trader_mi_trial_integrity_event_block_delete
  BEFORE DELETE ON public.trader_mi_trial_integrity_event
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_trial_integrity_block_mutation();
