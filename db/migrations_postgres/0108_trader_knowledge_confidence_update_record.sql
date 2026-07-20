-- DEE-415 / HTR-WP21: trader knowledge confidence update record (append-only)

CREATE TABLE "trader_knowledge_confidence_update_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"symbol" text NOT NULL,
	"knowledge_edge_id" uuid NOT NULL,
	"update_kind" text NOT NULL,
	"update_model_version" text NOT NULL,
	"prior_confidence" text NOT NULL,
	"posterior_confidence" text NOT NULL,
	"delta" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"eligible_resolution_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"pit_evidence_boundary" timestamp with time zone NOT NULL,
	"outcome_class" text NOT NULL,
	"score" text,
	"source_record_ids_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provenance_json" text NOT NULL,
	"terminal_reason" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_knowledge_confidence_update_record_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_knowledge_confidence_update_record" ADD CONSTRAINT "trader_knowledge_confidence_update_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_knowledge_confidence_update_record_id_organization_unique" ON "trader_knowledge_confidence_update_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tkcur_org_idempotency_key_uq" ON "trader_knowledge_confidence_update_record" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_knowledge_confidence_update_record_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_knowledge_confidence_update_record is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_knowledge_confidence_update_record_block_update ON public.trader_knowledge_confidence_update_record;
CREATE TRIGGER trader_knowledge_confidence_update_record_block_update
  BEFORE UPDATE ON public.trader_knowledge_confidence_update_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_knowledge_confidence_update_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_knowledge_confidence_update_record_block_delete ON public.trader_knowledge_confidence_update_record;
CREATE TRIGGER trader_knowledge_confidence_update_record_block_delete
  BEFORE DELETE ON public.trader_knowledge_confidence_update_record
  FOR EACH ROW EXECUTE FUNCTION public.waia_knowledge_confidence_update_record_block_mutation();
