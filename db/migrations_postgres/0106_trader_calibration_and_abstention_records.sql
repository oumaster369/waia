-- DEE-415 / HTR-WP21: calibration + abstention outcome records (append-only)

CREATE TABLE "trader_calibration_observation_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"forecast_record_id" uuid NOT NULL,
	"forecast_outcome_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"strategy_version" text,
	"regime" text NOT NULL,
	"horizon" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"eligible_resolution_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"pit_evidence_boundary" timestamp with time zone NOT NULL,
	"probability" text,
	"outcome_encoding" text,
	"brier_score" text,
	"log_loss_score" text,
	"scoring_eligible" boolean NOT NULL,
	"non_scoring_reason" text,
	"content_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provenance_json" text NOT NULL,
	"terminal_reason" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_calibration_observation_record_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
CREATE TABLE "trader_calibration_snapshot_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"forecast_model_version" text NOT NULL,
	"regime" text NOT NULL,
	"horizon" text NOT NULL,
	"sample_count" integer NOT NULL,
	"scoring_sample_count" integer NOT NULL,
	"brier_mean" text,
	"log_loss_mean" text,
	"calibration_status" text NOT NULL,
	"calibration_window" text NOT NULL,
	"survivorship_counts_json" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"eligible_resolution_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"pit_evidence_boundary" timestamp with time zone NOT NULL,
	"score" text,
	"content_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provenance_json" text NOT NULL,
	"terminal_reason" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_calibration_snapshot_record_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
CREATE TABLE "trader_abstention_outcome_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"decision_record_id" uuid NOT NULL,
	"forecast_record_id" uuid,
	"forecast_outcome_id" uuid,
	"model_version" text,
	"strategy_version" text,
	"regime" text NOT NULL,
	"horizon" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"eligible_resolution_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"pit_evidence_boundary" timestamp with time zone NOT NULL,
	"outcome_class" text NOT NULL,
	"score" text,
	"observed_outcome_json" text NOT NULL,
	"counterfactual_trade_sim_json" text,
	"source_record_ids_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provenance_json" text NOT NULL,
	"terminal_reason" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_abstention_outcome_record_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_calibration_observation_record" ADD CONSTRAINT "trader_calibration_observation_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_calibration_observation_record" ADD CONSTRAINT "trader_calibration_observation_record_forecast_outcome_fk" FOREIGN KEY ("forecast_outcome_id","organization_id") REFERENCES "public"."trader_forecast_outcome_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_calibration_snapshot_record" ADD CONSTRAINT "trader_calibration_snapshot_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_abstention_outcome_record" ADD CONSTRAINT "trader_abstention_outcome_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_abstention_outcome_record" ADD CONSTRAINT "trader_abstention_outcome_record_decision_record_fk" FOREIGN KEY ("decision_record_id","organization_id") REFERENCES "public"."trader_intelligence_decision_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_calibration_observation_record_id_organization_unique" ON "trader_calibration_observation_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tcor_org_idempotency_key_uq" ON "trader_calibration_observation_record" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_calibration_snapshot_record_id_organization_unique" ON "trader_calibration_snapshot_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tcsr_org_run_partition_uq" ON "trader_calibration_snapshot_record" USING btree ("organization_id","run_id","forecast_model_version","regime","horizon");
--> statement-breakpoint
CREATE UNIQUE INDEX "tcsr_org_idempotency_key_uq" ON "trader_calibration_snapshot_record" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_abstention_outcome_record_id_organization_unique" ON "trader_abstention_outcome_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "taor_org_run_cycle_symbol_decision_uq" ON "trader_abstention_outcome_record" USING btree ("organization_id","run_id","cycle_id","symbol","decision_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "taor_org_idempotency_key_uq" ON "trader_abstention_outcome_record" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_calibration_observation_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'trader_calibration_observation_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation'; END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_calibration_observation_record_block_update ON public.trader_calibration_observation_record;
CREATE TRIGGER trader_calibration_observation_record_block_update BEFORE UPDATE ON public.trader_calibration_observation_record FOR EACH ROW EXECUTE FUNCTION public.waia_calibration_observation_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_calibration_observation_record_block_delete ON public.trader_calibration_observation_record;
CREATE TRIGGER trader_calibration_observation_record_block_delete BEFORE DELETE ON public.trader_calibration_observation_record FOR EACH ROW EXECUTE FUNCTION public.waia_calibration_observation_record_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_calibration_snapshot_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'trader_calibration_snapshot_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation'; END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_calibration_snapshot_record_block_update ON public.trader_calibration_snapshot_record;
CREATE TRIGGER trader_calibration_snapshot_record_block_update BEFORE UPDATE ON public.trader_calibration_snapshot_record FOR EACH ROW EXECUTE FUNCTION public.waia_calibration_snapshot_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_calibration_snapshot_record_block_delete ON public.trader_calibration_snapshot_record;
CREATE TRIGGER trader_calibration_snapshot_record_block_delete BEFORE DELETE ON public.trader_calibration_snapshot_record FOR EACH ROW EXECUTE FUNCTION public.waia_calibration_snapshot_record_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_abstention_outcome_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'trader_abstention_outcome_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation'; END; $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_abstention_outcome_record_block_update ON public.trader_abstention_outcome_record;
CREATE TRIGGER trader_abstention_outcome_record_block_update BEFORE UPDATE ON public.trader_abstention_outcome_record FOR EACH ROW EXECUTE FUNCTION public.waia_abstention_outcome_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_abstention_outcome_record_block_delete ON public.trader_abstention_outcome_record;
CREATE TRIGGER trader_abstention_outcome_record_block_delete BEFORE DELETE ON public.trader_abstention_outcome_record FOR EACH ROW EXECUTE FUNCTION public.waia_abstention_outcome_record_block_mutation();
