CREATE TYPE "public"."research_dataset_split" AS ENUM('train', 'validation', 'blind');
--> statement-breakpoint
CREATE TYPE "public"."backtest_run_status" AS ENUM('pending', 'running', 'completed', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."strategy_candidate_status" AS ENUM('draft', 'registered', 'backtested', 'walk_forward_validated', 'blind_validated', 'rejected');
--> statement-breakpoint
CREATE TABLE "trader_market_bars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"bar_open_time" timestamp with time zone NOT NULL,
	"bar_close_time" timestamp with time zone NOT NULL,
	"open" text NOT NULL,
	"high" text NOT NULL,
	"low" text NOT NULL,
	"close" text NOT NULL,
	"volume" text NOT NULL,
	"content_digest" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_market_facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"fact_kind" text NOT NULL,
	"subject_ref" text NOT NULL,
	"schema_version" text NOT NULL,
	"payload_json" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_dataset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"train_bar_count" integer NOT NULL,
	"validation_bar_count" integer NOT NULL,
	"blind_bar_count" integer NOT NULL,
	"train_digest" text NOT NULL,
	"validation_digest" text NOT NULL,
	"blind_digest" text NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	"metadata_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_backtest_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"cost_model_version" text NOT NULL,
	"split" "research_dataset_split" NOT NULL,
	"status" "backtest_run_status" NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"evidence_digest" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_backtest_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"regime_label" text NOT NULL,
	"metrics_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_strategy_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"hypothesis_id" uuid,
	"trial_id" uuid,
	"status" "strategy_candidate_status" NOT NULL,
	"params_json" text NOT NULL,
	"blind_used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_walk_forward_windows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"window_index" integer NOT NULL,
	"in_sample_digest" text NOT NULL,
	"out_of_sample_digest" text NOT NULL,
	"metrics_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_blind_validation_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"metrics_json" text NOT NULL,
	"evidence_digest" text NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_market_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_kind" text NOT NULL,
	"subject_ref" text NOT NULL,
	"payload_json" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"confidence" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_knowledge_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"from_ref" text NOT NULL,
	"to_ref" text NOT NULL,
	"relation_kind" text NOT NULL,
	"confidence" text NOT NULL,
	"strength" text NOT NULL,
	"regime_scope" text NOT NULL,
	"failure_cases_json" text NOT NULL,
	"hypothesis_id" uuid,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_market_predictions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_ref" text NOT NULL,
	"prediction_json" text NOT NULL,
	"predicted_at" timestamp with time zone NOT NULL,
	"outcome_json" text,
	"verified_at" timestamp with time zone,
	"verification_result" text,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_operator_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"action_kind" text NOT NULL,
	"action_payload_json" text NOT NULL,
	"recommendation_json" text,
	"actor_kind" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_market_bars" ADD CONSTRAINT "trader_market_bars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_market_facts" ADD CONSTRAINT "trader_market_facts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_dataset" ADD CONSTRAINT "research_dataset_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_backtest_runs" ADD CONSTRAINT "trader_backtest_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_backtest_runs" ADD CONSTRAINT "trader_backtest_runs_dataset_id_research_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."research_dataset"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_backtest_results" ADD CONSTRAINT "trader_backtest_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_backtest_results" ADD CONSTRAINT "trader_backtest_results_run_id_trader_backtest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."trader_backtest_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_strategy_candidates" ADD CONSTRAINT "trader_strategy_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_walk_forward_windows" ADD CONSTRAINT "trader_walk_forward_windows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_walk_forward_windows" ADD CONSTRAINT "trader_walk_forward_windows_candidate_id_trader_strategy_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."trader_strategy_candidates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_blind_validation_results" ADD CONSTRAINT "trader_blind_validation_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_blind_validation_results" ADD CONSTRAINT "trader_blind_validation_results_candidate_id_trader_strategy_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."trader_strategy_candidates"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_blind_validation_results" ADD CONSTRAINT "trader_blind_validation_results_dataset_id_research_dataset_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."research_dataset"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_market_events" ADD CONSTRAINT "trader_market_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_knowledge_edges" ADD CONSTRAINT "trader_knowledge_edges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_market_predictions" ADD CONSTRAINT "trader_market_predictions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_operator_audit" ADD CONSTRAINT "trader_operator_audit_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_market_bars_org_symbol_interval_open_unique" ON "trader_market_bars" USING btree ("organization_id","symbol","interval","bar_open_time");
--> statement-breakpoint
CREATE INDEX "trader_market_bars_org_symbol_time_idx" ON "trader_market_bars" USING btree ("organization_id","symbol","bar_open_time");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_market_facts_org_digest_unique" ON "trader_market_facts" USING btree ("organization_id","content_digest");
--> statement-breakpoint
CREATE INDEX "trader_market_facts_org_kind_subject_idx" ON "trader_market_facts" USING btree ("organization_id","fact_kind","subject_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "research_dataset_org_name_unique" ON "research_dataset" USING btree ("organization_id","name");
--> statement-breakpoint
CREATE INDEX "trader_backtest_runs_org_strategy_idx" ON "trader_backtest_runs" USING btree ("organization_id","strategy_id","created_at");
--> statement-breakpoint
CREATE INDEX "trader_backtest_results_run_regime_idx" ON "trader_backtest_results" USING btree ("run_id","regime_label");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_candidates_org_strategy_version_unique" ON "trader_strategy_candidates" USING btree ("organization_id","strategy_id","strategy_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_walk_forward_windows_candidate_idx_unique" ON "trader_walk_forward_windows" USING btree ("candidate_id","window_index");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_blind_validation_results_candidate_unique" ON "trader_blind_validation_results" USING btree ("candidate_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_market_events_org_digest_unique" ON "trader_market_events" USING btree ("organization_id","content_digest");
--> statement-breakpoint
CREATE INDEX "trader_knowledge_edges_org_from_to_idx" ON "trader_knowledge_edges" USING btree ("organization_id","from_ref","to_ref");
--> statement-breakpoint
CREATE INDEX "trader_market_predictions_org_subject_idx" ON "trader_market_predictions" USING btree ("organization_id","subject_ref","predicted_at");
--> statement-breakpoint
CREATE INDEX "trader_operator_audit_org_created_idx" ON "trader_operator_audit" USING btree ("organization_id","created_at");
