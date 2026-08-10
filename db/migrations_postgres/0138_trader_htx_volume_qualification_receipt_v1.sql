-- DEE-526 / WP-VOLUME-QUAL: HTX volume qualification receipt (append-only)

CREATE TABLE "trader_htx_volume_qualification_receipt_v1" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"verdict" text NOT NULL,
	"authority_field" text,
	"sample_count" integer NOT NULL,
	"divergence_count" integer NOT NULL,
	"qualification_receipt_digest" text NOT NULL,
	"receipt_json" jsonb NOT NULL,
	"qualified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_htx_volume_qualification_receipt_v1_verdict_check" CHECK (
		"verdict" IN (
			'HTX_VOLUME_AUTHORITY_QUALIFIED',
			'HTX_VOLUME_AUTHORITY_BLOCKED_AMBIGUOUS_FIELDS',
			'HTX_VOLUME_AUTHORITY_BLOCKED_AMOUNT_VOL_DIVERGENCE',
			'HTX_VOLUME_AUTHORITY_BLOCKED_MISSING_FIELDS',
			'HTX_VOLUME_AUTHORITY_BLOCKED_NON_POSITIVE_PRICE'
		)
	),
	CONSTRAINT "trader_htx_volume_qualification_receipt_v1_digest_check" CHECK (
		"qualification_receipt_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_htx_volume_qualification_receipt_v1" ADD CONSTRAINT "trader_htx_volume_qualification_receipt_v1_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_htx_volume_qualification_receipt_v1_id_organization_unique" ON "trader_htx_volume_qualification_receipt_v1" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "thvqr_org_symbol_interval_digest_uq" ON "trader_htx_volume_qualification_receipt_v1" USING btree ("organization_id","symbol","interval","qualification_receipt_digest");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_htx_volume_qualification_receipt_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_htx_volume_qualification_receipt_v1 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_htx_volume_qualification_receipt_v1_block_update ON public.trader_htx_volume_qualification_receipt_v1;
CREATE TRIGGER trader_htx_volume_qualification_receipt_v1_block_update
  BEFORE UPDATE ON public.trader_htx_volume_qualification_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_htx_volume_qualification_receipt_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_htx_volume_qualification_receipt_v1_block_delete ON public.trader_htx_volume_qualification_receipt_v1;
CREATE TRIGGER trader_htx_volume_qualification_receipt_v1_block_delete
  BEFORE DELETE ON public.trader_htx_volume_qualification_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_htx_volume_qualification_receipt_block_mutation();
