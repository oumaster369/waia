-- AT-E11 / DEE-215: billing governance — dispute projection, append-only dispute events, append-only corrections.

CREATE TYPE "public"."invoice_dispute_status" AS ENUM('OPEN', 'RESOLVED_UPHELD', 'RESOLVED_CORRECTED');
--> statement-breakpoint
CREATE TYPE "public"."invoice_dispute_event_type" AS ENUM('OPENED', 'RESOLVED_UPHELD', 'RESOLVED_CORRECTED');
--> statement-breakpoint
CREATE TYPE "public"."invoice_correction_type" AS ENUM('CREDIT', 'REFUND');
--> statement-breakpoint
CREATE TABLE "trader_invoice_disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"status" "invoice_dispute_status" NOT NULL,
	"reason" text,
	"opened_by" text,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"last_event_seq" integer NOT NULL,
	"last_event_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_invoice_dispute_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"dispute_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_type" "invoice_dispute_event_type" NOT NULL,
	"reason" text,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"prev_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_invoice_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"dispute_id" uuid,
	"exchange_account_id" text NOT NULL,
	"reporting_period_id" text NOT NULL,
	"correction_type" "invoice_correction_type" NOT NULL,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"restored_hwm" text NOT NULL,
	"hwm_ledger_entry_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_invoice_disputes" ADD CONSTRAINT "trader_invoice_disputes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_invoice_disputes" ADD CONSTRAINT "trader_invoice_disputes_invoice_id_trader_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."trader_invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_invoice_dispute_events" ADD CONSTRAINT "trader_invoice_dispute_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_invoice_dispute_events" ADD CONSTRAINT "trader_invoice_dispute_events_dispute_id_trader_invoice_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."trader_invoice_disputes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_invoice_corrections" ADD CONSTRAINT "trader_invoice_corrections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_invoice_corrections" ADD CONSTRAINT "trader_invoice_corrections_invoice_id_trader_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."trader_invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_invoice_corrections" ADD CONSTRAINT "trader_invoice_corrections_dispute_id_trader_invoice_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."trader_invoice_disputes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_invoice_corrections" ADD CONSTRAINT "trader_invoice_corrections_hwm_ledger_entry_id_trader_hwm_ledger_id_fk" FOREIGN KEY ("hwm_ledger_entry_id") REFERENCES "public"."trader_hwm_ledger"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "trader_invoice_disputes_org_invoice_idx" ON "trader_invoice_disputes" USING btree ("organization_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "trader_invoice_disputes_org_status_idx" ON "trader_invoice_disputes" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_invoice_dispute_events_dispute_seq_unique" ON "trader_invoice_dispute_events" USING btree ("dispute_id","seq");
--> statement-breakpoint
CREATE INDEX "trader_invoice_corrections_org_invoice_idx" ON "trader_invoice_corrections" USING btree ("organization_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "trader_invoice_corrections_dispute_idx" ON "trader_invoice_corrections" USING btree ("dispute_id");
