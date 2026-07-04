-- DEE-381 / M6: pattern catalog score events + price-move explanations (append-only)

CREATE TABLE "trader_mi_pattern_score" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"definition_digest" text NOT NULL,
	"subject_ref" text NOT NULL,
	"match_score" text NOT NULL,
	"relevance_score" text NOT NULL,
	"confidence_mean" text NOT NULL,
	"confidence_band_low" text NOT NULL,
	"confidence_band_high" text NOT NULL,
	"prior_hits" integer NOT NULL,
	"prior_misses" integer NOT NULL,
	"regime" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_price_move_explanation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_ref" text NOT NULL,
	"price_move_json" text NOT NULL,
	"pattern_refs_json" text NOT NULL,
	"score_breakdown_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_mi_pattern_score" ADD CONSTRAINT "trader_mi_pattern_score_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_price_move_explanation" ADD CONSTRAINT "trader_price_move_explanation_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_mi_pattern_score_id_organization_unique" ON "trader_mi_pattern_score" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_mi_pattern_score_org_pattern_subject_idx" ON "trader_mi_pattern_score" USING btree ("organization_id","pattern_key","subject_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_price_move_explanation_id_organization_unique" ON "trader_price_move_explanation" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_price_move_explanation_org_subject_idx" ON "trader_price_move_explanation" USING btree ("organization_id","subject_ref");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_pattern_score_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_pattern_score is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_pattern_score_block_update ON public.trader_mi_pattern_score;
CREATE TRIGGER trader_mi_pattern_score_block_update
  BEFORE UPDATE ON public.trader_mi_pattern_score
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_pattern_score_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_pattern_score_block_delete ON public.trader_mi_pattern_score;
CREATE TRIGGER trader_mi_pattern_score_block_delete
  BEFORE DELETE ON public.trader_mi_pattern_score
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_pattern_score_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_price_move_explanation_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_price_move_explanation is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_price_move_explanation_block_update ON public.trader_price_move_explanation;
CREATE TRIGGER trader_price_move_explanation_block_update
  BEFORE UPDATE ON public.trader_price_move_explanation
  FOR EACH ROW EXECUTE FUNCTION public.waia_price_move_explanation_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_price_move_explanation_block_delete ON public.trader_price_move_explanation;
CREATE TRIGGER trader_price_move_explanation_block_delete
  BEFORE DELETE ON public.trader_price_move_explanation
  FOR EACH ROW EXECUTE FUNCTION public.waia_price_move_explanation_block_mutation();
