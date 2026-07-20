-- DEE-415 / HTR-WP21: trader hypothesis outcome record (append-only)

CREATE TABLE "trader_hypothesis_outcome_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"hypothesis_record_id" uuid NOT NULL,
	"decision_record_id" uuid,
	"forecast_outcome_ids_json" text NOT NULL,
	"model_version" text NOT NULL,
	"strategy_version" text,
	"regime" text NOT NULL,
	"horizon" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"eligible_resolution_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"pit_evidence_boundary" timestamp with time zone,
	"outcome_class" text NOT NULL,
	"score" text,
	"source_record_ids_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provenance_json" text NOT NULL,
	"terminal_reason" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_hypothesis_outcome_record_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_hypothesis_outcome_record" ADD CONSTRAINT "trader_hypothesis_outcome_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_hypothesis_outcome_record" ADD CONSTRAINT "trader_hypothesis_outcome_record_hypothesis_record_fk" FOREIGN KEY ("hypothesis_record_id","organization_id") REFERENCES "public"."trader_intelligence_hypothesis_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_hypothesis_outcome_record_id_organization_unique" ON "trader_hypothesis_outcome_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "thor_org_run_cycle_symbol_hypothesis_uq" ON "trader_hypothesis_outcome_record" USING btree ("organization_id","run_id","cycle_id","symbol","hypothesis_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "thor_org_idempotency_key_uq" ON "trader_hypothesis_outcome_record" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_hypothesis_outcome_record_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_hypothesis_outcome_record is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_hypothesis_outcome_record_block_update ON public.trader_hypothesis_outcome_record;
CREATE TRIGGER trader_hypothesis_outcome_record_block_update
  BEFORE UPDATE ON public.trader_hypothesis_outcome_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_hypothesis_outcome_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_hypothesis_outcome_record_block_delete ON public.trader_hypothesis_outcome_record;
CREATE TRIGGER trader_hypothesis_outcome_record_block_delete
  BEFORE DELETE ON public.trader_hypothesis_outcome_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_hypothesis_outcome_record_block_mutation();
