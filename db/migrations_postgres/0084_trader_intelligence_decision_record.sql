-- DEE-415 / HTR-WP14: intelligence decision record (append-only, LD-7)

CREATE TABLE "trader_intelligence_decision_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"cycle_envelope_id" uuid NOT NULL,
	"conviction_record_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"decision_class" text NOT NULL,
	"universal_terminal_reason_code" text NOT NULL,
	"why_not_cash_json" text,
	"why_cash_or_abstain_json" text,
	"gross_expected_reward" text,
	"expected_fees" text,
	"expected_slippage" text,
	"expected_other_costs" text,
	"expected_reward_after_costs" text,
	"cost_model_id" text,
	"cost_model_version" text,
	"cost_evidence_state" text NOT NULL,
	"cde_msv_permission_snapshot_json" text NOT NULL,
	"reason_codes_json" text NOT NULL,
	"strategy_id" text,
	"strategy_version" text,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_intelligence_decision_record_class_check" CHECK (
		"decision_class" IN ('TRADE', 'REDUCED_RISK', 'NO_TRADE')
	),
	CONSTRAINT "trader_intelligence_decision_record_cost_state_check" CHECK (
		"cost_evidence_state" IN ('AVAILABLE', 'UNAVAILABLE', 'NOT_APPLICABLE')
	),
	CONSTRAINT "trader_intelligence_decision_record_trade_cost_check" CHECK (
		"decision_class" NOT IN ('TRADE', 'REDUCED_RISK')
		OR (
			"why_not_cash_json" IS NOT NULL
			AND "cost_evidence_state" = 'AVAILABLE'
			AND "expected_reward_after_costs" IS NOT NULL
			AND "strategy_id" IS NOT NULL
			AND "strategy_version" IS NOT NULL
		)
	),
	CONSTRAINT "trader_intelligence_decision_record_no_trade_check" CHECK (
		"decision_class" <> 'NO_TRADE'
		OR "why_cash_or_abstain_json" IS NOT NULL
	),
	CONSTRAINT "trader_intelligence_decision_record_unavailable_no_trade_check" CHECK (
		"cost_evidence_state" <> 'UNAVAILABLE'
		OR "decision_class" = 'NO_TRADE'
	),
	CONSTRAINT "trader_intelligence_decision_record_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_decision_record" ADD CONSTRAINT "trader_intelligence_decision_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_decision_record" ADD CONSTRAINT "trader_intelligence_decision_record_cycle_envelope_org_fk" FOREIGN KEY ("cycle_envelope_id","organization_id") REFERENCES "public"."trader_intelligence_cycle_envelope"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_decision_record" ADD CONSTRAINT "trader_intelligence_decision_record_conviction_org_fk" FOREIGN KEY ("conviction_record_id","organization_id") REFERENCES "public"."trader_intelligence_conviction_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_decision_record_id_organization_unique" ON "trader_intelligence_decision_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_decision_record_org_run_cycle_symbol_unique" ON "trader_intelligence_decision_record" USING btree ("organization_id","run_id","cycle_id","symbol");
--> statement-breakpoint
CREATE INDEX "trader_intelligence_decision_record_org_cycle_envelope_idx" ON "trader_intelligence_decision_record" USING btree ("organization_id","cycle_envelope_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_decision_record_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_decision_record is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_decision_record_block_update ON public.trader_intelligence_decision_record;
CREATE TRIGGER trader_intelligence_decision_record_block_update
  BEFORE UPDATE ON public.trader_intelligence_decision_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_decision_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_decision_record_block_delete ON public.trader_intelligence_decision_record;
CREATE TRIGGER trader_intelligence_decision_record_block_delete
  BEFORE DELETE ON public.trader_intelligence_decision_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_decision_record_block_mutation();
