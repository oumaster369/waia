CREATE TYPE "public"."mi_source_status" AS ENUM('active', 'deprecated');
--> statement-breakpoint
CREATE TABLE "trader_mi_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue" text NOT NULL,
	"feed_kind" text NOT NULL,
	"symbol" text,
	"description" text,
	"status" "mi_source_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_mi_source" ADD CONSTRAINT "trader_mi_source_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_source_id_organization_unique" ON "trader_mi_source" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_source_org_venue_feed_symbol_unique" ON "trader_mi_source" USING btree ("organization_id","venue","feed_kind",COALESCE("symbol", ''));
--> statement-breakpoint
CREATE INDEX "trader_mi_source_org_status_idx" ON "trader_mi_source" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE TABLE "trader_mi_source_trust" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"trust_score" text NOT NULL,
	"rationale" text NOT NULL,
	"recorded_by" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"ingest_time" timestamp with time zone NOT NULL,
	"revision_of" uuid,
	"revision_seq" integer NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_mi_source_trust" ADD CONSTRAINT "trader_mi_source_trust_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_source_trust" ADD CONSTRAINT "trader_mi_source_trust_source_id_organization_id_trader_mi_source_id_organization_id_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."trader_mi_source"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_source_trust" ADD CONSTRAINT "trader_mi_source_trust_revision_of_organization_id_trader_mi_source_trust_id_organization_id_fk" FOREIGN KEY ("revision_of","organization_id") REFERENCES "public"."trader_mi_source_trust"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_source_trust_id_organization_unique" ON "trader_mi_source_trust" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_source_trust_org_source_seq_unique" ON "trader_mi_source_trust" USING btree ("organization_id","source_id","revision_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_source_trust_org_source_seq_idx" ON "trader_mi_source_trust" USING btree ("organization_id","source_id","revision_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_source_trust_org_source_event_time_idx" ON "trader_mi_source_trust" USING btree ("organization_id","source_id","event_time");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_source_trust_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_source_trust is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_source_trust_block_update ON public.trader_mi_source_trust;
CREATE TRIGGER trader_mi_source_trust_block_update
  BEFORE UPDATE ON public.trader_mi_source_trust
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_source_trust_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_source_trust_block_delete ON public.trader_mi_source_trust;
CREATE TRIGGER trader_mi_source_trust_block_delete
  BEFORE DELETE ON public.trader_mi_source_trust
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_source_trust_block_mutation();
