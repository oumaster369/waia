CREATE TYPE "public"."payment_event_type" AS ENUM('DETECTED', 'CONFIRMED', 'FAILED');
--> statement-breakpoint
CREATE TYPE "public"."payment_direction" AS ENUM('INBOUND', 'OUTBOUND');
--> statement-breakpoint
CREATE TYPE "public"."payment_subject_module" AS ENUM('trader', 'twin', 'marketplace');
--> statement-breakpoint
CREATE TYPE "public"."payment_failure_reason" AS ENUM('DROPPED', 'EXPIRED', 'REJECTED', 'ORPHANED');
--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('DETECTED', 'CONFIRMED', 'FAILED');
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_type" "payment_event_type" NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"subject_module" "payment_subject_module" NOT NULL,
	"subject_invoice_id" text,
	"idempotency_key" text,
	"reason" "payment_failure_reason",
	"settlement_network" text,
	"settlement_asset" text,
	"settlement_amount" text,
	"settlement_tx_hash" text,
	"transfer_index" integer,
	"confirmations_required" integer,
	"confirmations_observed" integer,
	"block_height" text,
	"observed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"valued_amount_usd" text,
	"valuation_source" text,
	"valuation_at" timestamp with time zone,
	"evidence_ref" text,
	"payment_address_id" uuid,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"prev_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "payment_status" NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"subject_module" "payment_subject_module" NOT NULL,
	"subject_invoice_id" text,
	"settlement_amount" text,
	"settlement_asset" text,
	"settlement_network" text,
	"settlement_tx_hash" text,
	"transfer_index" integer,
	"valued_amount_usd" text,
	"valuation_source" text,
	"last_event_seq" integer NOT NULL,
	"last_event_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_payment_id_seq_unique" ON "payment_events" USING btree ("payment_id","seq");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_org_idempotency_unique" ON "payment_events" USING btree ("organization_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_settlement_attribution_unique" ON "payment_events" USING btree ("settlement_network","settlement_tx_hash","transfer_index") WHERE "settlement_tx_hash" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "payment_events_org_payment_idx" ON "payment_events" USING btree ("organization_id","payment_id");
--> statement-breakpoint
CREATE INDEX "payment_events_subject_idx" ON "payment_events" USING btree ("subject_module","subject_invoice_id");
--> statement-breakpoint
CREATE INDEX "payments_org_status_idx" ON "payments" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "payments_subject_idx" ON "payments" USING btree ("subject_module","subject_invoice_id");
