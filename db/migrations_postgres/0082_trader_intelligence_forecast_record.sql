-- DEE-415 / HTR-WP14: intelligence forecast record (append-only, LD-6)

CREATE TABLE "trader_intelligence_forecast_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"cycle_envelope_id" uuid NOT NULL,
	"hypothesis_record_id" uuid NOT NULL,
	"conviction_record_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"forecast_key_digest" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"evidence_cutoff_at" timestamp with time zone NOT NULL,
	"target_window_start_at" timestamp with time zone NOT NULL,
	"target_window_end_at" timestamp with time zone NOT NULL,
	"market_question" text NOT NULL,
	"invalidation_conditions_json" text NOT NULL,
	"scenario_set_json" text NOT NULL,
	"forecast_confidence_json" text NOT NULL,
	"historical_profile_id" text NOT NULL,
	"historical_profile_digest" text NOT NULL,
	"matrix_digest" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"authoritative_link_digest" text NOT NULL,
	"forecast_model_version" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_intelligence_forecast_record_temporal_check" CHECK (
		"evidence_cutoff_at" <= "issued_at"
		AND "issued_at" <= "target_window_start_at"
		AND "target_window_start_at" < "target_window_end_at"
	),
	CONSTRAINT "trader_intelligence_forecast_record_digest_check" CHECK (
		"historical_profile_digest" ~ '^[0-9a-f]{64}$'
		AND "matrix_digest" ~ '^[0-9a-f]{64}$'
		AND "evidence_digest" ~ '^[0-9a-f]{64}$'
		AND "authoritative_link_digest" ~ '^[0-9a-f]{64}$'
		AND "content_digest" ~ '^[0-9a-f]{64}$'
		AND "forecast_key_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_forecast_record" ADD CONSTRAINT "trader_intelligence_forecast_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_forecast_record" ADD CONSTRAINT "trader_intelligence_forecast_record_cycle_envelope_org_fk" FOREIGN KEY ("cycle_envelope_id","organization_id") REFERENCES "public"."trader_intelligence_cycle_envelope"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_forecast_record" ADD CONSTRAINT "trader_intelligence_forecast_record_hypothesis_org_fk" FOREIGN KEY ("hypothesis_record_id","organization_id") REFERENCES "public"."trader_intelligence_hypothesis_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_forecast_record" ADD CONSTRAINT "trader_intelligence_forecast_record_conviction_org_fk" FOREIGN KEY ("conviction_record_id","organization_id") REFERENCES "public"."trader_intelligence_conviction_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_forecast_record_id_organization_unique" ON "trader_intelligence_forecast_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_forecast_record_org_run_cycle_symbol_key_unique" ON "trader_intelligence_forecast_record" USING btree ("organization_id","run_id","cycle_id","symbol","forecast_key_digest");
--> statement-breakpoint
CREATE INDEX "trader_intelligence_forecast_record_org_cycle_envelope_idx" ON "trader_intelligence_forecast_record" USING btree ("organization_id","cycle_envelope_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_forecast_record_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_forecast_record is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_forecast_record_block_update ON public.trader_intelligence_forecast_record;
CREATE TRIGGER trader_intelligence_forecast_record_block_update
  BEFORE UPDATE ON public.trader_intelligence_forecast_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_forecast_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_forecast_record_block_delete ON public.trader_intelligence_forecast_record;
CREATE TRIGGER trader_intelligence_forecast_record_block_delete
  BEFORE DELETE ON public.trader_intelligence_forecast_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_forecast_record_block_mutation();
