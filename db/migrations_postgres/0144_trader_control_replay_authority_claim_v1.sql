-- DEE-529 / WP-CONTROL-REPLAY-AUTH: TEST_ONLY control replay authority claim (append-only)

CREATE TABLE "trader_control_replay_authority_claim_v1" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"authority_class" text NOT NULL DEFAULT 'TEST_ONLY',
	"execution_purpose" text NOT NULL DEFAULT 'CONTROL_REPLAY',
	"execution_mode" text NOT NULL DEFAULT 'mock',
	"capital_eligible" boolean NOT NULL DEFAULT false,
	"control_replay_parity_digest" text NOT NULL,
	"config_freeze_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_control_replay_authority_claim_v1_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_control_replay_authority_claim_v1_authority_class_check" CHECK (
		"authority_class" = 'TEST_ONLY'
	),
	CONSTRAINT "trader_control_replay_authority_claim_v1_execution_purpose_check" CHECK (
		"execution_purpose" = 'CONTROL_REPLAY'
	),
	CONSTRAINT "trader_control_replay_authority_claim_v1_capital_eligible_check" CHECK (
		"capital_eligible" = false
	)
);
--> statement-breakpoint
ALTER TABLE "trader_control_replay_authority_claim_v1" ADD CONSTRAINT "trader_control_replay_authority_claim_v1_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_control_replay_authority_claim_v1_id_organization_unique" ON "trader_control_replay_authority_claim_v1" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tcra_v1_org_parity_digest_uq" ON "trader_control_replay_authority_claim_v1" USING btree ("organization_id","control_replay_parity_digest");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_control_replay_authority_claim_v1_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_control_replay_authority_claim_v1 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_control_replay_authority_claim_v1_block_update ON public.trader_control_replay_authority_claim_v1;
CREATE TRIGGER trader_control_replay_authority_claim_v1_block_update
  BEFORE UPDATE ON public.trader_control_replay_authority_claim_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_control_replay_authority_claim_v1_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_control_replay_authority_claim_v1_block_delete ON public.trader_control_replay_authority_claim_v1;
CREATE TRIGGER trader_control_replay_authority_claim_v1_block_delete
  BEFORE DELETE ON public.trader_control_replay_authority_claim_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_control_replay_authority_claim_v1_block_mutation();
