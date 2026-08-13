-- DEE-532 / WP-EXECOPP-QUAL: scientific admission receipt (append-only)

CREATE TABLE "trader_scientific_admission_receipt_v1" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_kind" text NOT NULL,
	"km_global_anchor_set_digest" text NOT NULL,
	"replica_root_family_identity_digest" text NOT NULL,
	"selected_k_config_dec" integer,
	"selected_m_config_dec" integer,
	"alpha_epi_config_scale8" text NOT NULL,
	"selected_package_generation_identity_digest" text,
	"selected_package_content_digest" text,
	"evidence_semantic_digest" text NOT NULL,
	"receipt_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_scientific_admission_receipt_v1_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	),
	CONSTRAINT "trader_scientific_admission_receipt_v1_evidence_semantic_digest_check" CHECK (
		"evidence_semantic_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_scientific_admission_receipt_v1" ADD CONSTRAINT "trader_scientific_admission_receipt_v1_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_scientific_admission_receipt_v1_id_organization_unique" ON "trader_scientific_admission_receipt_v1" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tsar_v1_org_evidence_digest_uq" ON "trader_scientific_admission_receipt_v1" USING btree ("organization_id","evidence_semantic_digest");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_scientific_admission_receipt_v1_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_scientific_admission_receipt_v1 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_scientific_admission_receipt_v1_block_update ON public.trader_scientific_admission_receipt_v1;
CREATE TRIGGER trader_scientific_admission_receipt_v1_block_update
  BEFORE UPDATE ON public.trader_scientific_admission_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_scientific_admission_receipt_v1_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_scientific_admission_receipt_v1_block_delete ON public.trader_scientific_admission_receipt_v1;
CREATE TRIGGER trader_scientific_admission_receipt_v1_block_delete
  BEFORE DELETE ON public.trader_scientific_admission_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_scientific_admission_receipt_v1_block_mutation();
