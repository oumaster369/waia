-- DEE-382 / M7: event attribution memory (append-only)

CREATE TABLE "trader_event_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"source_ref" text NOT NULL,
	"symbol_scope" text NOT NULL,
	"payload_json" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_event_classification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_record_id" uuid NOT NULL,
	"classification_kind" text NOT NULL,
	"rule_id" text NOT NULL,
	"confidence" text NOT NULL,
	"rationale_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_event_attribution" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_record_id" uuid NOT NULL,
	"subject_ref" text NOT NULL,
	"subject_kind" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"attribution_strength" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_event_attribution_confidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_record_id" uuid NOT NULL,
	"subject_ref" text NOT NULL,
	"confidence_mean" text NOT NULL,
	"confidence_band_low" text NOT NULL,
	"confidence_band_high" text NOT NULL,
	"prior_supporting" integer NOT NULL,
	"prior_contradicting" integer NOT NULL,
	"rationale_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_event_explanation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_ref" text NOT NULL,
	"price_move_json" text NOT NULL,
	"event_refs_json" text NOT NULL,
	"pattern_refs_json" text NOT NULL,
	"score_breakdown_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_event_record" ADD CONSTRAINT "trader_event_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_event_classification" ADD CONSTRAINT "trader_event_classification_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_event_classification" ADD CONSTRAINT "trader_event_classification_event_record_id_trader_event_record_id_fk" FOREIGN KEY ("event_record_id") REFERENCES "public"."trader_event_record"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_event_attribution" ADD CONSTRAINT "trader_event_attribution_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_event_attribution" ADD CONSTRAINT "trader_event_attribution_event_record_id_trader_event_record_id_fk" FOREIGN KEY ("event_record_id") REFERENCES "public"."trader_event_record"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_event_attribution_confidence" ADD CONSTRAINT "trader_event_attribution_confidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_event_attribution_confidence" ADD CONSTRAINT "trader_event_attribution_confidence_event_record_id_trader_event_record_id_fk" FOREIGN KEY ("event_record_id") REFERENCES "public"."trader_event_record"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_event_explanation" ADD CONSTRAINT "trader_event_explanation_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_event_record_id_organization_unique" ON "trader_event_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_event_record_org_digest_unique" ON "trader_event_record" USING btree ("organization_id","content_digest");
--> statement-breakpoint
CREATE INDEX "trader_event_record_org_key_idx" ON "trader_event_record" USING btree ("organization_id","event_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_event_classification_id_organization_unique" ON "trader_event_classification" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_event_classification_org_event_idx" ON "trader_event_classification" USING btree ("organization_id","event_record_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_event_attribution_id_organization_unique" ON "trader_event_attribution" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_event_attribution_org_subject_idx" ON "trader_event_attribution" USING btree ("organization_id","subject_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_event_attribution_confidence_id_organization_unique" ON "trader_event_attribution_confidence" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_event_explanation_id_organization_unique" ON "trader_event_explanation" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_event_explanation_org_subject_idx" ON "trader_event_explanation" USING btree ("organization_id","subject_ref");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_event_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_event_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_record_block_update ON public.trader_event_record;
CREATE TRIGGER trader_event_record_block_update BEFORE UPDATE ON public.trader_event_record FOR EACH ROW EXECUTE FUNCTION public.waia_event_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_record_block_delete ON public.trader_event_record;
CREATE TRIGGER trader_event_record_block_delete BEFORE DELETE ON public.trader_event_record FOR EACH ROW EXECUTE FUNCTION public.waia_event_record_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_event_classification_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_event_classification is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_classification_block_update ON public.trader_event_classification;
CREATE TRIGGER trader_event_classification_block_update BEFORE UPDATE ON public.trader_event_classification FOR EACH ROW EXECUTE FUNCTION public.waia_event_classification_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_classification_block_delete ON public.trader_event_classification;
CREATE TRIGGER trader_event_classification_block_delete BEFORE DELETE ON public.trader_event_classification FOR EACH ROW EXECUTE FUNCTION public.waia_event_classification_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_event_attribution_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_event_attribution is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_attribution_block_update ON public.trader_event_attribution;
CREATE TRIGGER trader_event_attribution_block_update BEFORE UPDATE ON public.trader_event_attribution FOR EACH ROW EXECUTE FUNCTION public.waia_event_attribution_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_attribution_block_delete ON public.trader_event_attribution;
CREATE TRIGGER trader_event_attribution_block_delete BEFORE DELETE ON public.trader_event_attribution FOR EACH ROW EXECUTE FUNCTION public.waia_event_attribution_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_event_attribution_confidence_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_event_attribution_confidence is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_attribution_confidence_block_update ON public.trader_event_attribution_confidence;
CREATE TRIGGER trader_event_attribution_confidence_block_update BEFORE UPDATE ON public.trader_event_attribution_confidence FOR EACH ROW EXECUTE FUNCTION public.waia_event_attribution_confidence_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_attribution_confidence_block_delete ON public.trader_event_attribution_confidence;
CREATE TRIGGER trader_event_attribution_confidence_block_delete BEFORE DELETE ON public.trader_event_attribution_confidence FOR EACH ROW EXECUTE FUNCTION public.waia_event_attribution_confidence_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_event_explanation_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_event_explanation is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_explanation_block_update ON public.trader_event_explanation;
CREATE TRIGGER trader_event_explanation_block_update BEFORE UPDATE ON public.trader_event_explanation FOR EACH ROW EXECUTE FUNCTION public.waia_event_explanation_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_event_explanation_block_delete ON public.trader_event_explanation;
CREATE TRIGGER trader_event_explanation_block_delete BEFORE DELETE ON public.trader_event_explanation FOR EACH ROW EXECUTE FUNCTION public.waia_event_explanation_block_mutation();
