CREATE TYPE "public"."mi_hypothesis_kind" AS ENUM('market_claim');
--> statement-breakpoint
CREATE TYPE "public"."mi_hypothesis_lifecycle_state" AS ENUM('PROPOSED');
--> statement-breakpoint
CREATE TABLE "trader_mi_hypothesis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"hypothesis_kind" "mi_hypothesis_kind" NOT NULL,
	"hypothesis_key" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" text NOT NULL,
	"definition_json" text NOT NULL,
	"definition_digest" text NOT NULL,
	"supersedes_json" text,
	"version_seq" integer NOT NULL,
	"revision_of" uuid,
	"authored_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_mi_hypothesis_lifecycle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"hypothesis_key" text NOT NULL,
	"lifecycle_state" "mi_hypothesis_lifecycle_state" NOT NULL,
	"rationale" text NOT NULL,
	"recorded_by" text NOT NULL,
	"seq" integer NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_mi_hypothesis" ADD CONSTRAINT "trader_mi_hypothesis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_hypothesis_id_organization_unique" ON "trader_mi_hypothesis" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "trader_mi_hypothesis" ADD CONSTRAINT "trader_mi_hypothesis_revision_of_organization_id_trader_mi_hypothesis_id_organization_id_fk" FOREIGN KEY ("revision_of","organization_id") REFERENCES "public"."trader_mi_hypothesis"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_hypothesis_lifecycle" ADD CONSTRAINT "trader_mi_hypothesis_lifecycle_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_hypothesis_lifecycle" ADD CONSTRAINT "trader_mi_hypothesis_lifecycle_hypothesis_id_organization_id_trader_mi_hypothesis_id_organization_id_fk" FOREIGN KEY ("hypothesis_id","organization_id") REFERENCES "public"."trader_mi_hypothesis"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_hypothesis_org_key_seq_unique" ON "trader_mi_hypothesis" USING btree ("organization_id","hypothesis_key","version_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_hypothesis_org_kind_name_idx" ON "trader_mi_hypothesis" USING btree ("organization_id","hypothesis_kind","name");
--> statement-breakpoint
CREATE INDEX "trader_mi_hypothesis_org_key_seq_idx" ON "trader_mi_hypothesis" USING btree ("organization_id","hypothesis_key","version_seq");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_hypothesis_lifecycle_id_organization_unique" ON "trader_mi_hypothesis_lifecycle" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_hypothesis_lifecycle_org_key_seq_unique" ON "trader_mi_hypothesis_lifecycle" USING btree ("organization_id","hypothesis_key","seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_hypothesis_lifecycle_org_key_seq_idx" ON "trader_mi_hypothesis_lifecycle" USING btree ("organization_id","hypothesis_key","seq");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_hypothesis_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_hypothesis is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_hypothesis_block_update ON public.trader_mi_hypothesis;
CREATE TRIGGER trader_mi_hypothesis_block_update
  BEFORE UPDATE ON public.trader_mi_hypothesis
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_hypothesis_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_hypothesis_block_delete ON public.trader_mi_hypothesis;
CREATE TRIGGER trader_mi_hypothesis_block_delete
  BEFORE DELETE ON public.trader_mi_hypothesis
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_hypothesis_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_hypothesis_lifecycle_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_hypothesis_lifecycle is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_hypothesis_lifecycle_block_update ON public.trader_mi_hypothesis_lifecycle;
CREATE TRIGGER trader_mi_hypothesis_lifecycle_block_update
  BEFORE UPDATE ON public.trader_mi_hypothesis_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_hypothesis_lifecycle_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_hypothesis_lifecycle_block_delete ON public.trader_mi_hypothesis_lifecycle;
CREATE TRIGGER trader_mi_hypothesis_lifecycle_block_delete
  BEFORE DELETE ON public.trader_mi_hypothesis_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_hypothesis_lifecycle_block_mutation();
