-- DEE-528 / WP-DECISION-ECON: intelligence decision economics v2 (append-only)

CREATE TABLE "trader_intelligence_decision_economics_v2" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"forecast_id" uuid NOT NULL,
	"decision_record_id" uuid,
	"ev_lower" text NOT NULL,
	"ev_base" text NOT NULL,
	"ev_upper" text NOT NULL,
	"decision_actionable" boolean NOT NULL,
	"economic_semantics_version" text NOT NULL,
	"scientific_admission_receipt_digest" text,
	"mu_base_replicas_json" text NOT NULL,
	"mu_lower_replicas_json" text NOT NULL,
	"reason_codes_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_intelligence_decision_economics_v2_content_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_decision_economics_v2" ADD CONSTRAINT "trader_intelligence_decision_economics_v2_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_decision_economics_v2_id_organization_unique" ON "trader_intelligence_decision_economics_v2" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tide_v2_org_forecast_uq" ON "trader_intelligence_decision_economics_v2" USING btree ("organization_id","forecast_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_decision_economics_v2_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_decision_economics_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_decision_economics_v2_block_update ON public.trader_intelligence_decision_economics_v2;
CREATE TRIGGER trader_intelligence_decision_economics_v2_block_update
  BEFORE UPDATE ON public.trader_intelligence_decision_economics_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_decision_economics_v2_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_decision_economics_v2_block_delete ON public.trader_intelligence_decision_economics_v2;
CREATE TRIGGER trader_intelligence_decision_economics_v2_block_delete
  BEFORE DELETE ON public.trader_intelligence_decision_economics_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_decision_economics_v2_block_mutation();
