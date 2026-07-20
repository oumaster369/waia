-- DEE-415 / HTR-WP13: intelligence conviction record (append-only, Model B)

CREATE TABLE "trader_intelligence_conviction_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"cycle_envelope_id" uuid NOT NULL,
	"active_hypothesis_record_id" uuid,
	"conviction_scope" text NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"conviction_value" text NOT NULL,
	"conviction_class" text NOT NULL,
	"reason_codes_json" text NOT NULL,
	"sustained_cycles" integer NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_intelligence_conviction_record_scope_check" CHECK (
		"conviction_scope" IN ('ACTIVE_HYPOTHESIS', 'NONE')
		AND (
			("conviction_scope" = 'ACTIVE_HYPOTHESIS' AND "active_hypothesis_record_id" IS NOT NULL)
			OR ("conviction_scope" = 'NONE' AND "active_hypothesis_record_id" IS NULL)
		)
	)
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_conviction_record" ADD CONSTRAINT "trader_intelligence_conviction_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_conviction_record" ADD CONSTRAINT "trader_intelligence_conviction_record_cycle_envelope_org_fk" FOREIGN KEY ("cycle_envelope_id","organization_id") REFERENCES "public"."trader_intelligence_cycle_envelope"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_conviction_record" ADD CONSTRAINT "trader_intelligence_conviction_record_active_hypothesis_org_fk" FOREIGN KEY ("active_hypothesis_record_id","organization_id") REFERENCES "public"."trader_intelligence_hypothesis_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_conviction_record_id_organization_unique" ON "trader_intelligence_conviction_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_conviction_record_org_run_cycle_symbol_unique" ON "trader_intelligence_conviction_record" USING btree ("organization_id","run_id","cycle_id","symbol");
--> statement-breakpoint
CREATE INDEX "trader_intelligence_conviction_record_org_cycle_envelope_idx" ON "trader_intelligence_conviction_record" USING btree ("organization_id","cycle_envelope_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_conviction_record_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_conviction_record is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_conviction_record_block_update ON public.trader_intelligence_conviction_record;
CREATE TRIGGER trader_intelligence_conviction_record_block_update
  BEFORE UPDATE ON public.trader_intelligence_conviction_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_conviction_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_conviction_record_block_delete ON public.trader_intelligence_conviction_record;
CREATE TRIGGER trader_intelligence_conviction_record_block_delete
  BEFORE DELETE ON public.trader_intelligence_conviction_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_conviction_record_block_mutation();
