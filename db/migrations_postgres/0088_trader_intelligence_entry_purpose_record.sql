-- DEE-415 / HTR-WP14: intelligence entry-purpose record (append-only, position-purpose owner)

CREATE TABLE "trader_intelligence_entry_purpose_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"decision_record_id" uuid NOT NULL,
	"primary_forecast_record_id" uuid NOT NULL,
	"hypothesis_record_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"original_thesis_json" text NOT NULL,
	"expected_path" text NOT NULL,
	"forecast_horizon" text NOT NULL,
	"entry_reason" text NOT NULL,
	"entry_condition_json" text NOT NULL,
	"invalidation_condition_json" text NOT NULL,
	"initial_stop_model_json" text NOT NULL,
	"target_model_json" text NOT NULL,
	"optional_partial_targets_json" text,
	"maximum_holding_until" timestamp with time zone NOT NULL,
	"why_not_cash_json" text NOT NULL,
	"risk_amount_json" text NOT NULL,
	"expected_reward_after_costs" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_intelligence_entry_purpose_record_digest_check" CHECK (
		"evidence_digest" ~ '^[0-9a-f]{64}$'
		AND "content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_entry_purpose_record" ADD CONSTRAINT "trader_intelligence_entry_purpose_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_entry_purpose_record" ADD CONSTRAINT "trader_intelligence_entry_purpose_record_decision_org_fk" FOREIGN KEY ("decision_record_id","organization_id") REFERENCES "public"."trader_intelligence_decision_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_entry_purpose_record" ADD CONSTRAINT "trader_intelligence_entry_purpose_record_forecast_org_fk" FOREIGN KEY ("primary_forecast_record_id","organization_id") REFERENCES "public"."trader_intelligence_forecast_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_entry_purpose_record" ADD CONSTRAINT "trader_intelligence_entry_purpose_record_hypothesis_org_fk" FOREIGN KEY ("hypothesis_record_id","organization_id") REFERENCES "public"."trader_intelligence_hypothesis_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_entry_purpose_record_id_organization_unique" ON "trader_intelligence_entry_purpose_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_entry_purpose_record_org_decision_unique" ON "trader_intelligence_entry_purpose_record" USING btree ("organization_id","decision_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_entry_purpose_record_org_run_cycle_symbol_unique" ON "trader_intelligence_entry_purpose_record" USING btree ("organization_id","run_id","cycle_id","symbol");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_entry_purpose_record_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_entry_purpose_record is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_entry_purpose_record_block_update ON public.trader_intelligence_entry_purpose_record;
CREATE TRIGGER trader_intelligence_entry_purpose_record_block_update
  BEFORE UPDATE ON public.trader_intelligence_entry_purpose_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_entry_purpose_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_entry_purpose_record_block_delete ON public.trader_intelligence_entry_purpose_record;
CREATE TRIGGER trader_intelligence_entry_purpose_record_block_delete
  BEFORE DELETE ON public.trader_intelligence_entry_purpose_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_entry_purpose_record_block_mutation();
