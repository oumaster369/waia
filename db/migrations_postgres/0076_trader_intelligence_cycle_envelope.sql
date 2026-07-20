-- DEE-415 / HTR-WP13: intelligence cycle envelope (append-only)

CREATE TABLE "trader_intelligence_cycle_envelope" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"historical_profile_id" text NOT NULL,
	"historical_profile_digest" text NOT NULL,
	"matrix_digest" text NOT NULL,
	"terminal_reason_code" text NOT NULL,
	"input_semantic_digest" text NOT NULL,
	"output_semantic_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_cycle_envelope" ADD CONSTRAINT "trader_intelligence_cycle_envelope_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_cycle_envelope_id_organization_unique" ON "trader_intelligence_cycle_envelope" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_cycle_envelope_org_run_cycle_symbol_unique" ON "trader_intelligence_cycle_envelope" USING btree ("organization_id","run_id","cycle_id","symbol");
--> statement-breakpoint
CREATE INDEX "trader_intelligence_cycle_envelope_org_run_evaluated_idx" ON "trader_intelligence_cycle_envelope" USING btree ("organization_id","run_id","evaluated_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_cycle_envelope_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_cycle_envelope is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_cycle_envelope_block_update ON public.trader_intelligence_cycle_envelope;
CREATE TRIGGER trader_intelligence_cycle_envelope_block_update
  BEFORE UPDATE ON public.trader_intelligence_cycle_envelope
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_cycle_envelope_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_cycle_envelope_block_delete ON public.trader_intelligence_cycle_envelope;
CREATE TRIGGER trader_intelligence_cycle_envelope_block_delete
  BEFORE DELETE ON public.trader_intelligence_cycle_envelope
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_cycle_envelope_block_mutation();
