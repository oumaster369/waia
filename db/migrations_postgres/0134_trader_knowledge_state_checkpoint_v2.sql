-- DEE-534 / WP-KNOWLEDGE-STATE: bounded knowledge checkpoint v2 (append-only)

CREATE TABLE "trader_knowledge_state_checkpoint_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"checkpoint_seq" bigint NOT NULL,
	"model_version" text NOT NULL,
	"calibration_snapshot_digest" text NOT NULL,
	"knowledge_semantic_digest" text NOT NULL,
	"rejected_research_states_json" text NOT NULL,
	"promoted_research_states_json" text NOT NULL,
	"forecast_package_generation_digest" text,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_knowledge_state_checkpoint_v2_knowledge_semantic_digest_check" CHECK (
		"knowledge_semantic_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_knowledge_state_checkpoint_v2_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_knowledge_state_checkpoint_v2" ADD CONSTRAINT "trader_knowledge_state_checkpoint_v2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_knowledge_state_checkpoint_v2_id_organization_unique" ON "trader_knowledge_state_checkpoint_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tksc_v2_org_checkpoint_seq_uq" ON "trader_knowledge_state_checkpoint_v2" USING btree ("organization_id","checkpoint_seq");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_knowledge_state_checkpoint_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_knowledge_state_checkpoint_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_knowledge_state_checkpoint_v2_block_update ON public.trader_knowledge_state_checkpoint_v2;
CREATE TRIGGER trader_knowledge_state_checkpoint_v2_block_update
  BEFORE UPDATE ON public.trader_knowledge_state_checkpoint_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_knowledge_state_checkpoint_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_knowledge_state_checkpoint_v2_block_delete ON public.trader_knowledge_state_checkpoint_v2;
CREATE TRIGGER trader_knowledge_state_checkpoint_v2_block_delete
  BEFORE DELETE ON public.trader_knowledge_state_checkpoint_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_knowledge_state_checkpoint_v2_block_mutation();
