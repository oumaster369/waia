-- AT-E12 S3-C-A: settlement exception reconciliation schema (ADR-0016).

CREATE TYPE "public"."settlement_reconciliation_case_status" AS ENUM(
  'OPEN',
  'ASSIGNED',
  'UNDER_REVIEW',
  'DECISION_PENDING',
  'RESOLVED',
  'CANCELLED',
  'ESCALATED'
);
--> statement-breakpoint
CREATE TYPE "public"."settlement_application_source" AS ENUM('AUTO', 'MANUAL');
--> statement-breakpoint
CREATE TABLE "trader_settlement_reconciliation_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"exception_reason" text,
	"status" "settlement_reconciliation_case_status" DEFAULT 'OPEN' NOT NULL,
	"priority" smallint NOT NULL,
	"resolution_type" text,
	"assigned_to" uuid,
	"claim_expires_at" timestamp with time zone,
	"cooling_off_until" timestamp with time zone,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_event_seq" integer NOT NULL,
	"last_event_digest" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_settlement_reconciliation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"payload" jsonb NOT NULL,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"prev_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_settlement_applications" ADD COLUMN "application_source" "settlement_application_source" DEFAULT 'AUTO' NOT NULL;
--> statement-breakpoint
ALTER TABLE "trader_settlement_applications" ADD COLUMN "reconciliation_case_id" uuid;
--> statement-breakpoint
ALTER TABLE "trader_settlement_reconciliation_cases" ADD CONSTRAINT "trader_settlement_reconciliation_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_reconciliation_cases" ADD CONSTRAINT "trader_settlement_reconciliation_cases_settlement_id_trader_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."trader_settlements"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_reconciliation_cases" ADD CONSTRAINT "trader_settlement_reconciliation_cases_payment_id_payments_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("payment_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_reconciliation_events" ADD CONSTRAINT "trader_settlement_reconciliation_events_case_id_trader_settlement_reconciliation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."trader_settlement_reconciliation_cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_reconciliation_events" ADD CONSTRAINT "trader_settlement_reconciliation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_applications" ADD CONSTRAINT "trader_settlement_applications_reconciliation_case_id_trader_settlement_reconciliation_cases_id_fk" FOREIGN KEY ("reconciliation_case_id") REFERENCES "public"."trader_settlement_reconciliation_cases"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_settlement_reconciliation_cases_settlement_id_unique" ON "trader_settlement_reconciliation_cases" USING btree ("settlement_id");
--> statement-breakpoint
CREATE INDEX "trader_settlement_reconciliation_cases_org_status_priority_idx" ON "trader_settlement_reconciliation_cases" USING btree ("organization_id","status","priority" DESC,"opened_at");
--> statement-breakpoint
CREATE INDEX "trader_settlement_reconciliation_cases_open_opened_at_idx" ON "trader_settlement_reconciliation_cases" USING btree ("opened_at") WHERE "status" = 'OPEN';
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_settlement_reconciliation_events_case_seq_unique" ON "trader_settlement_reconciliation_events" USING btree ("case_id","seq");
