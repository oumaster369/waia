-- DEE-531 / WP-RESEARCH-HARNESS: preregistered trial registration (append-only)

CREATE TABLE "trader_research_trial_registration_v1" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"trial_identity_digest" text NOT NULL,
	"model_transform_version" text NOT NULL,
	"comparison_family_id" text NOT NULL,
	"symbol" text NOT NULL,
	"primary_horizon_minutes" integer NOT NULL,
	"partition_receipt_digest" text NOT NULL,
	"authority_status" text NOT NULL DEFAULT 'RESEARCH_ONLY',
	"registration_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_research_trial_registration_v1_trial_identity_digest_check" CHECK (
		"trial_identity_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_research_trial_registration_v1_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_research_trial_registration_v1_authority_status_check" CHECK (
		"authority_status" = 'RESEARCH_ONLY'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_research_trial_registration_v1" ADD CONSTRAINT "trader_research_trial_registration_v1_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_research_trial_registration_v1_id_organization_unique" ON "trader_research_trial_registration_v1" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trtr_v1_org_trial_identity_uq" ON "trader_research_trial_registration_v1" USING btree ("organization_id","trial_identity_digest");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_research_trial_registration_v1_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_research_trial_registration_v1 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_research_trial_registration_v1_block_update ON public.trader_research_trial_registration_v1;
CREATE TRIGGER trader_research_trial_registration_v1_block_update
  BEFORE UPDATE ON public.trader_research_trial_registration_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_research_trial_registration_v1_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_research_trial_registration_v1_block_delete ON public.trader_research_trial_registration_v1;
CREATE TRIGGER trader_research_trial_registration_v1_block_delete
  BEFORE DELETE ON public.trader_research_trial_registration_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_research_trial_registration_v1_block_mutation();
