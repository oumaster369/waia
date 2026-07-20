-- DEE-415 / HTR-WP13: intelligence hypothesis record (append-only)

CREATE TABLE "trader_intelligence_hypothesis_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"cycle_envelope_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"hypothesis_type" text NOT NULL,
	"hypothesis_status" text NOT NULL,
	"confidence_value" text NOT NULL,
	"thesis_digest" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"mi_hypothesis_id" uuid,
	"authoritative_link_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_hypothesis_record" ADD CONSTRAINT "trader_intelligence_hypothesis_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_hypothesis_record" ADD CONSTRAINT "trader_intelligence_hypothesis_record_cycle_envelope_org_fk" FOREIGN KEY ("cycle_envelope_id","organization_id") REFERENCES "public"."trader_intelligence_cycle_envelope"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_hypothesis_record" ADD CONSTRAINT "trader_intelligence_hypothesis_record_mi_hypothesis_org_fk" FOREIGN KEY ("mi_hypothesis_id","organization_id") REFERENCES "public"."trader_mi_hypothesis"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_hypothesis_record_id_organization_unique" ON "trader_intelligence_hypothesis_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_hypothesis_record_org_run_cycle_symbol_type_unique" ON "trader_intelligence_hypothesis_record" USING btree ("organization_id","run_id","cycle_id","symbol","hypothesis_type");
--> statement-breakpoint
CREATE INDEX "trader_intelligence_hypothesis_record_org_cycle_envelope_idx" ON "trader_intelligence_hypothesis_record" USING btree ("organization_id","cycle_envelope_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_hypothesis_record_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_hypothesis_record is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_hypothesis_record_block_update ON public.trader_intelligence_hypothesis_record;
CREATE TRIGGER trader_intelligence_hypothesis_record_block_update
  BEFORE UPDATE ON public.trader_intelligence_hypothesis_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_hypothesis_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_hypothesis_record_block_delete ON public.trader_intelligence_hypothesis_record;
CREATE TRIGGER trader_intelligence_hypothesis_record_block_delete
  BEFORE DELETE ON public.trader_intelligence_hypothesis_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_hypothesis_record_block_mutation();
