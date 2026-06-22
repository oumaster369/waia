CREATE TYPE "public"."mi_pattern_kind" AS ENUM('recurring_structure');
--> statement-breakpoint
CREATE TYPE "public"."mi_pattern_lifecycle_state" AS ENUM('ACTIVE', 'ARCHIVED');
--> statement-breakpoint
CREATE TABLE "trader_mi_pattern" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"pattern_kind" "mi_pattern_kind" NOT NULL,
	"pattern_key" text NOT NULL,
	"name" text NOT NULL,
	"schema_version" text NOT NULL,
	"definition_json" text NOT NULL,
	"definition_digest" text NOT NULL,
	"structural_signature" text NOT NULL,
	"trial_budget_max" integer NOT NULL,
	"version_seq" integer NOT NULL,
	"revision_of" uuid,
	"authored_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_mi_pattern_lifecycle" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"pattern_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"lifecycle_state" "mi_pattern_lifecycle_state" NOT NULL,
	"rationale" text NOT NULL,
	"recorded_by" text NOT NULL,
	"seq" integer NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_mi_pattern" ADD CONSTRAINT "trader_mi_pattern_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_pattern" ADD CONSTRAINT "trader_mi_pattern_revision_of_organization_id_trader_mi_pattern_id_organization_id_fk" FOREIGN KEY ("revision_of","organization_id") REFERENCES "public"."trader_mi_pattern"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_pattern_lifecycle" ADD CONSTRAINT "trader_mi_pattern_lifecycle_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_mi_pattern_lifecycle" ADD CONSTRAINT "trader_mi_pattern_lifecycle_pattern_id_organization_id_trader_mi_pattern_id_organization_id_fk" FOREIGN KEY ("pattern_id","organization_id") REFERENCES "public"."trader_mi_pattern"("id","organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_pattern_id_organization_unique" ON "trader_mi_pattern" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_pattern_org_key_seq_unique" ON "trader_mi_pattern" USING btree ("organization_id","pattern_key","version_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_pattern_org_kind_name_idx" ON "trader_mi_pattern" USING btree ("organization_id","pattern_kind","name");
--> statement-breakpoint
CREATE INDEX "trader_mi_pattern_org_key_seq_idx" ON "trader_mi_pattern" USING btree ("organization_id","pattern_key","version_seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_pattern_org_structural_sig_idx" ON "trader_mi_pattern" USING btree ("organization_id","structural_signature");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_pattern_lifecycle_id_organization_unique" ON "trader_mi_pattern_lifecycle" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_pattern_lifecycle_org_key_seq_unique" ON "trader_mi_pattern_lifecycle" USING btree ("organization_id","pattern_key","seq");
--> statement-breakpoint
CREATE INDEX "trader_mi_pattern_lifecycle_org_key_seq_idx" ON "trader_mi_pattern_lifecycle" USING btree ("organization_id","pattern_key","seq");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_pattern_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_pattern is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_pattern_block_update ON public.trader_mi_pattern;
CREATE TRIGGER trader_mi_pattern_block_update
  BEFORE UPDATE ON public.trader_mi_pattern
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_pattern_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_pattern_block_delete ON public.trader_mi_pattern;
CREATE TRIGGER trader_mi_pattern_block_delete
  BEFORE DELETE ON public.trader_mi_pattern
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_pattern_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_pattern_lifecycle_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_pattern_lifecycle is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_pattern_lifecycle_block_update ON public.trader_mi_pattern_lifecycle;
CREATE TRIGGER trader_mi_pattern_lifecycle_block_update
  BEFORE UPDATE ON public.trader_mi_pattern_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_pattern_lifecycle_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_pattern_lifecycle_block_delete ON public.trader_mi_pattern_lifecycle;
CREATE TRIGGER trader_mi_pattern_lifecycle_block_delete
  BEFORE DELETE ON public.trader_mi_pattern_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_pattern_lifecycle_block_mutation();
