CREATE TYPE "public"."exchange_credential_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "exchange_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"exchange_account_id" text NOT NULL,
	"api_key_masked" text,
	"encrypted_payload" text,
	"payload_key_version" text,
	"wrapped_dek_key_version" text,
	"wrapped_dek_key" text,
	"permission_metadata" text,
	"status" "exchange_credential_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "exchange_credentials" ADD CONSTRAINT "exchange_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_credentials_org_venue_account_idx" ON "exchange_credentials" USING btree ("organization_id","venue","exchange_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_credentials_active_org_venue_account_unique" ON "exchange_credentials" USING btree ("organization_id","venue","exchange_account_id") WHERE "status" = 'active';
