CREATE TYPE "public"."payment_wallet_kind" AS ENUM('DEPOSIT', 'DISBURSEMENT', 'RESERVE');
--> statement-breakpoint
CREATE TYPE "public"."payment_wallet_custody_model" AS ENUM('PLATFORM', 'ORGANIZATION', 'CUSTODIAL');
--> statement-breakpoint
CREATE TYPE "public"."payment_address_event_type" AS ENUM('GENERATED', 'RESERVED', 'RELEASED', 'ASSIGNED', 'ACTIVATED', 'ROTATED', 'RETIRED', 'ARCHIVED', 'RECOVERED');
--> statement-breakpoint
CREATE TYPE "public"."payment_address_status" AS ENUM('GENERATED', 'RESERVED', 'RELEASED', 'ASSIGNED', 'ACTIVATED', 'ROTATED', 'RETIRED', 'ARCHIVED', 'RECOVERED');
--> statement-breakpoint
CREATE TABLE "payment_wallets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"wallet_kind" "payment_wallet_kind" NOT NULL,
	"custody_model" "payment_wallet_custody_model" NOT NULL,
	"control_model" text NOT NULL,
	"provider_ref" text,
	"derivation_scheme" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_address_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"address_id" uuid NOT NULL,
	"wallet_id" uuid,
	"organization_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event_type" "payment_address_event_type" NOT NULL,
	"network" text NOT NULL,
	"address" text,
	"subject_module" "payment_subject_module",
	"subject_ref" text,
	"binding_ref" text,
	"reason" text,
	"schema_version" text NOT NULL,
	"record_content_digest" text NOT NULL,
	"prev_event_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_addresses" (
	"address_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"wallet_id" uuid,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"status" "payment_address_status" NOT NULL,
	"subject_module" "payment_subject_module",
	"subject_ref" text,
	"binding_ref" text,
	"last_event_seq" integer NOT NULL,
	"last_event_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_wallets" ADD CONSTRAINT "payment_wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_address_events" ADD CONSTRAINT "payment_address_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_addresses" ADD CONSTRAINT "payment_addresses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_addresses" ADD CONSTRAINT "payment_addresses_wallet_id_payment_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."payment_wallets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payment_wallets_org_status_idx" ON "payment_wallets" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_address_events_address_id_seq_unique" ON "payment_address_events" USING btree ("address_id","seq");
--> statement-breakpoint
CREATE INDEX "payment_address_events_org_address_idx" ON "payment_address_events" USING btree ("organization_id","address_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_addresses_network_address_unique" ON "payment_addresses" USING btree ("network","address");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_addresses_org_subject_active_unique" ON "payment_addresses" USING btree ("organization_id","subject_module","subject_ref") WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX "payment_addresses_org_status_idx" ON "payment_addresses" USING btree ("organization_id","status");
