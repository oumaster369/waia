CREATE TYPE "public"."strategy_promotion_governance_state" AS ENUM('DRAFT', 'PENDING_CONFIRM', 'COOLING_OFF', 'EFFECTIVE', 'CANCELLED', 'REVOKED');
--> statement-breakpoint
CREATE TYPE "public"."strategy_target_deployment_state" AS ENUM('LIVE_LIMITED');
--> statement-breakpoint
CREATE TABLE "trader_strategy_promotion_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"git_commit_sha" text NOT NULL,
	"target_deployment_state" "strategy_target_deployment_state" NOT NULL,
	"hypothesis" text NOT NULL,
	"intended_regime" text NOT NULL,
	"cost_model_json" jsonb NOT NULL,
	"failure_modes_json" jsonb NOT NULL,
	"reason_code_distribution_json" jsonb NOT NULL,
	"paper_trading_evidence_json" jsonb NOT NULL,
	"evidence_content_digest" text NOT NULL,
	"confidence_attestation_json" jsonb NOT NULL,
	"record_content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"state" "strategy_promotion_governance_state" NOT NULL,
	"actor_id" text,
	"requested_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cooling_off_ends_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"superseded_by_record_id" uuid,
	"state_version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_strategy_promotion_records" ADD CONSTRAINT "trader_strategy_promotion_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_strategy_promotion_records" ADD CONSTRAINT "trader_strategy_promotion_records_superseded_by_record_id_trader_strategy_promotion_records_id_fk" FOREIGN KEY ("superseded_by_record_id") REFERENCES "public"."trader_strategy_promotion_records"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "trader_strategy_promotion_org_strategy_state_idx" ON "trader_strategy_promotion_records" USING btree ("organization_id","strategy_id","state");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_promotion_org_strategy_effective_unique" ON "trader_strategy_promotion_records" USING btree ("organization_id","strategy_id") WHERE "state" = 'EFFECTIVE';
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_strategy_promotion_org_idempotency_unique" ON "trader_strategy_promotion_records" USING btree ("organization_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
