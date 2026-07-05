-- DEE-383 / M8: discovery substrate (append-only)

CREATE TABLE "trader_discovery_research_campaign" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_key" text NOT NULL,
	"name" text NOT NULL,
	"research_program" text NOT NULL,
	"description" text NOT NULL,
	"symbol_scope" text NOT NULL,
	"dataset_digest" text,
	"current_state" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_campaign_state_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"prior_state" text,
	"new_state" text NOT NULL,
	"rationale" text NOT NULL,
	"operator_attestation_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_research_question" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"question_text" text NOT NULL,
	"research_program" text NOT NULL,
	"observation_refs_json" text NOT NULL,
	"structure_cluster_id" uuid,
	"status" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_observation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"payload_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_structure_cluster" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"signature_key" text NOT NULL,
	"payload_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_hypothesis_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"research_question_id" uuid NOT NULL,
	"payload_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_consolidation_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"action" text NOT NULL,
	"source_refs_json" text NOT NULL,
	"canonical_ref" text,
	"rationale" text NOT NULL,
	"operator_attestation_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_strategy_synthesis" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version" text NOT NULL,
	"template_id" text NOT NULL,
	"params_json" text NOT NULL,
	"parent_strategy_version" text,
	"hypothesis_proposal_id" uuid,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_evidence_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"hypothesis_ref" text,
	"candidate_ref" text,
	"dimension" text NOT NULL,
	"direction" text NOT NULL,
	"strength" text NOT NULL,
	"uncertainty_band_low" text NOT NULL,
	"uncertainty_band_high" text NOT NULL,
	"contradiction_refs_json" text NOT NULL,
	"source_run_digest" text NOT NULL,
	"relevance_score" text NOT NULL,
	"rationale_json" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_comparison_score" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_ref" text NOT NULL,
	"dimension_scores_json" text NOT NULL,
	"aggregate_rank_score" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_promotion_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"candidate_id" text NOT NULL,
	"comparison_digest" text NOT NULL,
	"recommends" text NOT NULL,
	"rationale" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_discovery_retirement_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subject_ref" text NOT NULL,
	"subject_kind" text NOT NULL,
	"rationale" text NOT NULL,
	"operator_attestation_digest" text NOT NULL,
	"content_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trader_discovery_research_campaign" ADD CONSTRAINT "trader_discovery_research_campaign_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_campaign_state_record" ADD CONSTRAINT "trader_discovery_campaign_state_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_campaign_state_record" ADD CONSTRAINT "trader_discovery_campaign_state_record_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_research_question" ADD CONSTRAINT "trader_discovery_research_question_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_research_question" ADD CONSTRAINT "trader_discovery_research_question_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_observation" ADD CONSTRAINT "trader_discovery_observation_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_observation" ADD CONSTRAINT "trader_discovery_observation_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_structure_cluster" ADD CONSTRAINT "trader_discovery_structure_cluster_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_structure_cluster" ADD CONSTRAINT "trader_discovery_structure_cluster_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_hypothesis_proposal" ADD CONSTRAINT "trader_discovery_hypothesis_proposal_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_hypothesis_proposal" ADD CONSTRAINT "trader_discovery_hypothesis_proposal_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_hypothesis_proposal" ADD CONSTRAINT "trader_discovery_hypothesis_proposal_research_question_id_trader_discovery_research_question_id_fk" FOREIGN KEY ("research_question_id") REFERENCES "public"."trader_discovery_research_question"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_consolidation_record" ADD CONSTRAINT "trader_discovery_consolidation_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_consolidation_record" ADD CONSTRAINT "trader_discovery_consolidation_record_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_strategy_synthesis" ADD CONSTRAINT "trader_discovery_strategy_synthesis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_strategy_synthesis" ADD CONSTRAINT "trader_discovery_strategy_synthesis_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_evidence_record" ADD CONSTRAINT "trader_discovery_evidence_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_evidence_record" ADD CONSTRAINT "trader_discovery_evidence_record_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_comparison_score" ADD CONSTRAINT "trader_discovery_comparison_score_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_comparison_score" ADD CONSTRAINT "trader_discovery_comparison_score_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_promotion_proposal" ADD CONSTRAINT "trader_discovery_promotion_proposal_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_promotion_proposal" ADD CONSTRAINT "trader_discovery_promotion_proposal_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_retirement_record" ADD CONSTRAINT "trader_discovery_retirement_record_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trader_discovery_retirement_record" ADD CONSTRAINT "trader_discovery_retirement_record_campaign_id_trader_discovery_research_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."trader_discovery_research_campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_research_campaign_id_organization_unique" ON "trader_discovery_research_campaign" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_research_campaign_org_key_unique" ON "trader_discovery_research_campaign" USING btree ("organization_id","campaign_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_research_campaign_org_digest_unique" ON "trader_discovery_research_campaign" USING btree ("organization_id","content_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_campaign_state_record_id_organization_unique" ON "trader_discovery_campaign_state_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_discovery_campaign_state_record_org_campaign_idx" ON "trader_discovery_campaign_state_record" USING btree ("organization_id","campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_research_question_id_organization_unique" ON "trader_discovery_research_question" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_discovery_research_question_org_campaign_idx" ON "trader_discovery_research_question" USING btree ("organization_id","campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_observation_id_organization_unique" ON "trader_discovery_observation" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_discovery_observation_org_campaign_idx" ON "trader_discovery_observation" USING btree ("organization_id","campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_structure_cluster_id_organization_unique" ON "trader_discovery_structure_cluster" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_discovery_structure_cluster_org_campaign_idx" ON "trader_discovery_structure_cluster" USING btree ("organization_id","campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_hypothesis_proposal_id_organization_unique" ON "trader_discovery_hypothesis_proposal" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_discovery_hypothesis_proposal_org_campaign_idx" ON "trader_discovery_hypothesis_proposal" USING btree ("organization_id","campaign_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_consolidation_record_id_organization_unique" ON "trader_discovery_consolidation_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_strategy_synthesis_id_organization_unique" ON "trader_discovery_strategy_synthesis" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_strategy_synthesis_org_strategy_version_unique" ON "trader_discovery_strategy_synthesis" USING btree ("organization_id","strategy_id","strategy_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_evidence_record_id_organization_unique" ON "trader_discovery_evidence_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE INDEX "trader_discovery_evidence_record_org_candidate_idx" ON "trader_discovery_evidence_record" USING btree ("organization_id","candidate_ref");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_comparison_score_id_organization_unique" ON "trader_discovery_comparison_score" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_promotion_proposal_id_organization_unique" ON "trader_discovery_promotion_proposal" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trader_discovery_retirement_record_id_organization_unique" ON "trader_discovery_retirement_record" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_research_campaign_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_research_campaign is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_research_campaign_block_update ON public.trader_discovery_research_campaign;
CREATE TRIGGER trader_discovery_research_campaign_block_update BEFORE UPDATE ON public.trader_discovery_research_campaign FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_research_campaign_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_research_campaign_block_delete ON public.trader_discovery_research_campaign;
CREATE TRIGGER trader_discovery_research_campaign_block_delete BEFORE DELETE ON public.trader_discovery_research_campaign FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_research_campaign_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_campaign_state_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_campaign_state_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_campaign_state_record_block_update ON public.trader_discovery_campaign_state_record;
CREATE TRIGGER trader_discovery_campaign_state_record_block_update BEFORE UPDATE ON public.trader_discovery_campaign_state_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_campaign_state_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_campaign_state_record_block_delete ON public.trader_discovery_campaign_state_record;
CREATE TRIGGER trader_discovery_campaign_state_record_block_delete BEFORE DELETE ON public.trader_discovery_campaign_state_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_campaign_state_record_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_research_question_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_research_question is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_research_question_block_update ON public.trader_discovery_research_question;
CREATE TRIGGER trader_discovery_research_question_block_update BEFORE UPDATE ON public.trader_discovery_research_question FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_research_question_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_research_question_block_delete ON public.trader_discovery_research_question;
CREATE TRIGGER trader_discovery_research_question_block_delete BEFORE DELETE ON public.trader_discovery_research_question FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_research_question_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_observation_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_observation is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_observation_block_update ON public.trader_discovery_observation;
CREATE TRIGGER trader_discovery_observation_block_update BEFORE UPDATE ON public.trader_discovery_observation FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_observation_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_observation_block_delete ON public.trader_discovery_observation;
CREATE TRIGGER trader_discovery_observation_block_delete BEFORE DELETE ON public.trader_discovery_observation FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_observation_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_structure_cluster_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_structure_cluster is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_structure_cluster_block_update ON public.trader_discovery_structure_cluster;
CREATE TRIGGER trader_discovery_structure_cluster_block_update BEFORE UPDATE ON public.trader_discovery_structure_cluster FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_structure_cluster_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_structure_cluster_block_delete ON public.trader_discovery_structure_cluster;
CREATE TRIGGER trader_discovery_structure_cluster_block_delete BEFORE DELETE ON public.trader_discovery_structure_cluster FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_structure_cluster_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_hypothesis_proposal_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_hypothesis_proposal is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_hypothesis_proposal_block_update ON public.trader_discovery_hypothesis_proposal;
CREATE TRIGGER trader_discovery_hypothesis_proposal_block_update BEFORE UPDATE ON public.trader_discovery_hypothesis_proposal FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_hypothesis_proposal_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_hypothesis_proposal_block_delete ON public.trader_discovery_hypothesis_proposal;
CREATE TRIGGER trader_discovery_hypothesis_proposal_block_delete BEFORE DELETE ON public.trader_discovery_hypothesis_proposal FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_hypothesis_proposal_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_consolidation_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_consolidation_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_consolidation_record_block_update ON public.trader_discovery_consolidation_record;
CREATE TRIGGER trader_discovery_consolidation_record_block_update BEFORE UPDATE ON public.trader_discovery_consolidation_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_consolidation_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_consolidation_record_block_delete ON public.trader_discovery_consolidation_record;
CREATE TRIGGER trader_discovery_consolidation_record_block_delete BEFORE DELETE ON public.trader_discovery_consolidation_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_consolidation_record_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_strategy_synthesis_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_strategy_synthesis is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_strategy_synthesis_block_update ON public.trader_discovery_strategy_synthesis;
CREATE TRIGGER trader_discovery_strategy_synthesis_block_update BEFORE UPDATE ON public.trader_discovery_strategy_synthesis FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_strategy_synthesis_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_strategy_synthesis_block_delete ON public.trader_discovery_strategy_synthesis;
CREATE TRIGGER trader_discovery_strategy_synthesis_block_delete BEFORE DELETE ON public.trader_discovery_strategy_synthesis FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_strategy_synthesis_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_evidence_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_evidence_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_evidence_record_block_update ON public.trader_discovery_evidence_record;
CREATE TRIGGER trader_discovery_evidence_record_block_update BEFORE UPDATE ON public.trader_discovery_evidence_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_evidence_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_evidence_record_block_delete ON public.trader_discovery_evidence_record;
CREATE TRIGGER trader_discovery_evidence_record_block_delete BEFORE DELETE ON public.trader_discovery_evidence_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_evidence_record_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_comparison_score_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_comparison_score is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_comparison_score_block_update ON public.trader_discovery_comparison_score;
CREATE TRIGGER trader_discovery_comparison_score_block_update BEFORE UPDATE ON public.trader_discovery_comparison_score FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_comparison_score_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_comparison_score_block_delete ON public.trader_discovery_comparison_score;
CREATE TRIGGER trader_discovery_comparison_score_block_delete BEFORE DELETE ON public.trader_discovery_comparison_score FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_comparison_score_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_promotion_proposal_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_promotion_proposal is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_promotion_proposal_block_update ON public.trader_discovery_promotion_proposal;
CREATE TRIGGER trader_discovery_promotion_proposal_block_update BEFORE UPDATE ON public.trader_discovery_promotion_proposal FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_promotion_proposal_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_promotion_proposal_block_delete ON public.trader_discovery_promotion_proposal;
CREATE TRIGGER trader_discovery_promotion_proposal_block_delete BEFORE DELETE ON public.trader_discovery_promotion_proposal FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_promotion_proposal_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_discovery_retirement_record_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_discovery_retirement_record is append-only (no % allowed)', TG_OP USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_retirement_record_block_update ON public.trader_discovery_retirement_record;
CREATE TRIGGER trader_discovery_retirement_record_block_update BEFORE UPDATE ON public.trader_discovery_retirement_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_retirement_record_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_discovery_retirement_record_block_delete ON public.trader_discovery_retirement_record;
CREATE TRIGGER trader_discovery_retirement_record_block_delete BEFORE DELETE ON public.trader_discovery_retirement_record FOR EACH ROW EXECUTE FUNCTION public.waia_discovery_retirement_record_block_mutation();
