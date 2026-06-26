-- AT-E12 S3-B: settlement engine schema (two-level settlement + account status).

CREATE TYPE "public"."account_status" AS ENUM('ACTIVE', 'SUSPENDED');
--> statement-breakpoint
CREATE TYPE "public"."account_status_event_type" AS ENUM('REACTIVATED');
--> statement-breakpoint
CREATE TYPE "public"."settlement_outcome" AS ENUM('APPLIED', 'EXCEPTION');
--> statement-breakpoint
ALTER TABLE "trader_invoices" ADD COLUMN "settled_amount" text DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "trader_invoices" ADD COLUMN "paid_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "trader_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"settlement_network" text,
	"settlement_tx_hash" text,
	"transfer_index" integer,
	"block_height" text,
	"asset" text,
	"on_chain_amount" text,
	"valued_amount" text,
	"valuation_currency" text,
	"valuation_basis" text,
	"outcome" "settlement_outcome" NOT NULL,
	"exception_reason" text,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"prev_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_settlement_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settlement_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"applied_amount" text NOT NULL,
	"invoice_status_after" "invoice_status" NOT NULL,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_account_status" (
	"organization_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"status" "account_status" NOT NULL,
	"reason" text,
	"last_event_seq" integer NOT NULL,
	"last_event_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_account_status_org_account_pk" PRIMARY KEY("organization_id","exchange_account_id")
);
--> statement-breakpoint
CREATE TABLE "trader_account_status_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"exchange_account_id" text NOT NULL,
	"seq" integer NOT NULL,
	"event_type" "account_status_event_type" NOT NULL,
	"reason" text,
	"source_payment_id" uuid,
	"source_invoice_id" uuid,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"prev_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_settlements" ADD CONSTRAINT "trader_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlements" ADD CONSTRAINT "trader_settlements_payment_id_payments_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("payment_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_applications" ADD CONSTRAINT "trader_settlement_applications_settlement_id_trader_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."trader_settlements"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_applications" ADD CONSTRAINT "trader_settlement_applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_settlement_applications" ADD CONSTRAINT "trader_settlement_applications_invoice_id_trader_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."trader_invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_account_status" ADD CONSTRAINT "trader_account_status_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_account_status_events" ADD CONSTRAINT "trader_account_status_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_settlements_payment_id_unique" ON "trader_settlements" USING btree ("payment_id");
--> statement-breakpoint
CREATE INDEX "trader_settlements_org_account_idx" ON "trader_settlements" USING btree ("organization_id","exchange_account_id");
--> statement-breakpoint
CREATE INDEX "trader_settlements_outcome_idx" ON "trader_settlements" USING btree ("outcome");
--> statement-breakpoint
CREATE INDEX "trader_settlement_applications_settlement_idx" ON "trader_settlement_applications" USING btree ("settlement_id");
--> statement-breakpoint
CREATE INDEX "trader_settlement_applications_invoice_idx" ON "trader_settlement_applications" USING btree ("invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_account_status_events_org_account_seq_unique" ON "trader_account_status_events" USING btree ("organization_id","exchange_account_id","seq");
