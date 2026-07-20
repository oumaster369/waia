-- DEE-415 / HTR-WP14: intelligence decision-forecast link (append-only, relational)

CREATE TABLE "trader_intelligence_decision_forecast_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"decision_record_id" uuid NOT NULL,
	"forecast_record_id" uuid NOT NULL,
	"link_role" text NOT NULL,
	"ordinal" integer NOT NULL,
	"content_digest" text NOT NULL,
	"schema_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trader_intelligence_decision_forecast_link_role_check" CHECK (
		"link_role" IN ('PRIMARY', 'SUPPORTING')
	),
	CONSTRAINT "trader_intelligence_decision_forecast_link_ordinal_check" CHECK (
		"ordinal" >= 0
	),
	CONSTRAINT "trader_intelligence_decision_forecast_link_digest_check" CHECK (
		"content_digest" ~ '^[0-9a-f]{64}$'
	)
);
--> statement-breakpoint
ALTER TABLE "trader_intelligence_decision_forecast_link" ADD CONSTRAINT "trader_intelligence_decision_forecast_link_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_decision_forecast_link" ADD CONSTRAINT "trader_intelligence_decision_forecast_link_decision_org_fk" FOREIGN KEY ("decision_record_id","organization_id") REFERENCES "public"."trader_intelligence_decision_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_intelligence_decision_forecast_link" ADD CONSTRAINT "trader_intelligence_decision_forecast_link_forecast_org_fk" FOREIGN KEY ("forecast_record_id","organization_id") REFERENCES "public"."trader_intelligence_forecast_record"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_decision_forecast_link_id_organization_unique" ON "trader_intelligence_decision_forecast_link" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_decision_forecast_link_org_decision_forecast_unique" ON "trader_intelligence_decision_forecast_link" USING btree ("organization_id","decision_record_id","forecast_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_intelligence_decision_forecast_link_org_decision_ordinal_unique" ON "trader_intelligence_decision_forecast_link" USING btree ("organization_id","decision_record_id","ordinal");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_intelligence_decision_forecast_link_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_intelligence_decision_forecast_link is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_decision_forecast_link_block_update ON public.trader_intelligence_decision_forecast_link;
CREATE TRIGGER trader_intelligence_decision_forecast_link_block_update
  BEFORE UPDATE ON public.trader_intelligence_decision_forecast_link
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_decision_forecast_link_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_intelligence_decision_forecast_link_block_delete ON public.trader_intelligence_decision_forecast_link;
CREATE TRIGGER trader_intelligence_decision_forecast_link_block_delete
  BEFORE DELETE ON public.trader_intelligence_decision_forecast_link
  FOR EACH ROW EXECUTE FUNCTION public.waia_intelligence_decision_forecast_link_block_mutation();
