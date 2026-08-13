-- DEE-533 / WP-PATTERN-RESEARCH: pattern definition substrate (append-only, RESEARCH_ONLY)

CREATE TABLE "trader_pattern_definition_v1" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"schema_version" text NOT NULL,
	"quantizer_version" text NOT NULL,
	"state_vector_version" text NOT NULL,
	"ablation_level" text NOT NULL,
	"authority_status" text NOT NULL DEFAULT 'RESEARCH_ONLY',
	"definition_json" text NOT NULL,
	"definition_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"authored_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_pattern_definition_v1_definition_digest_check" CHECK (
		"definition_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_pattern_definition_v1_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_pattern_definition_v1_authority_status_check" CHECK (
		"authority_status" = 'RESEARCH_ONLY'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_pattern_definition_v1" ADD CONSTRAINT "trader_pattern_definition_v1_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_pattern_definition_v1_id_organization_unique" ON "trader_pattern_definition_v1" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tpd_v1_org_pattern_key_digest_uq" ON "trader_pattern_definition_v1" USING btree ("organization_id","pattern_key","definition_digest");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_pattern_definition_v1_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_pattern_definition_v1 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_pattern_definition_v1_block_update ON public.trader_pattern_definition_v1;
CREATE TRIGGER trader_pattern_definition_v1_block_update
  BEFORE UPDATE ON public.trader_pattern_definition_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_pattern_definition_v1_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_pattern_definition_v1_block_delete ON public.trader_pattern_definition_v1;
CREATE TRIGGER trader_pattern_definition_v1_block_delete
  BEFORE DELETE ON public.trader_pattern_definition_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_pattern_definition_v1_block_mutation();
