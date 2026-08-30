CREATE TABLE public.trader_guardian_assessments_v2 (
  assessment_id text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  position_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  symbol text NOT NULL,
  opening_causal_lineage_digest text NOT NULL CHECK (opening_causal_lineage_digest ~ '^[0-9a-f]{64}$'),
  reality_frontier_id text NOT NULL,
  reality_content_digest text NOT NULL CHECK (reality_content_digest ~ '^[0-9a-f]{64}$'),
  qualified_evidence_bundle_id text NOT NULL,
  qualified_evidence_content_digest text NOT NULL CHECK (qualified_evidence_content_digest ~ '^[0-9a-f]{64}$'),
  information_sufficiency_profile text NOT NULL CHECK (information_sufficiency_profile = 'OPEN_POSITION_REASSESSMENT'),
  open_position_sufficiency text NOT NULL CHECK (open_position_sufficiency IN ('SUFFICIENT', 'INSUFFICIENT')),
  new_opportunity_sufficiency text NOT NULL CHECK (new_opportunity_sufficiency IN ('SUFFICIENT', 'INSUFFICIENT')),
  recommendation text NOT NULL CHECK (recommendation IN ('HOLD', 'REDUCE_PARTIAL', 'REDUCE_FULL')),
  target_reduction_bps integer NOT NULL CHECK (
    (recommendation = 'HOLD' AND target_reduction_bps = 0)
    OR (recommendation = 'REDUCE_PARTIAL' AND target_reduction_bps > 0 AND target_reduction_bps < 10000)
    OR (recommendation = 'REDUCE_FULL' AND target_reduction_bps = 10000)
  ),
  reason_codes_json jsonb NOT NULL CHECK (jsonb_typeof(reason_codes_json) = 'array'),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  canonical_json text NOT NULL CHECK (canonical_json::jsonb IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trader_guardian_assessments_v2_id_org_unique UNIQUE (assessment_id, organization_id),
  CONSTRAINT trader_guardian_assessments_v2_org_digest_unique UNIQUE (organization_id, content_digest),
  CONSTRAINT trader_guardian_assessments_v2_trade_scope_fk FOREIGN KEY (position_id, organization_id)
    REFERENCES public.trader_trades(id, organization_id),
  CONSTRAINT trader_guardian_assessments_v2_lot_scope_fk FOREIGN KEY (lot_id, organization_id)
    REFERENCES public.trader_position_lots(id, organization_id),
  CONSTRAINT trader_guardian_assessments_v2_content_address_check
    CHECK (assessment_id = 'guardian-assessment-v2:' || content_digest),
  CONSTRAINT trader_guardian_assessments_v2_insufficient_hold_check
    CHECK (open_position_sufficiency = 'SUFFICIENT' OR recommendation = 'HOLD')
);
--> statement-breakpoint
CREATE INDEX trader_guardian_assessments_v2_org_lot_idx
  ON public.trader_guardian_assessments_v2 (organization_id, lot_id, created_at);
--> statement-breakpoint
ALTER TABLE public.trader_guardian_assessments_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trader_guardian_assessments_v2_deny_authenticated_select
  ON public.trader_guardian_assessments_v2 FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY trader_guardian_assessments_v2_deny_authenticated_insert
  ON public.trader_guardian_assessments_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_guardian_assessments_v2_deny_authenticated_update
  ON public.trader_guardian_assessments_v2 FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY trader_guardian_assessments_v2_deny_authenticated_delete
  ON public.trader_guardian_assessments_v2 FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_guardian_assessment_v2_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_guardian_assessments_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_guardian_assessments_v2_block_update
  BEFORE UPDATE ON public.trader_guardian_assessments_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_guardian_assessment_v2_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_guardian_assessments_v2_block_delete
  BEFORE DELETE ON public.trader_guardian_assessments_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_guardian_assessment_v2_block_mutation();
--> statement-breakpoint
CREATE TABLE public.trader_guardian_protective_consumptions_v2 (
  content_digest text PRIMARY KEY CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mandate_id text NOT NULL,
  mandate_content_digest text NOT NULL CHECK (mandate_content_digest ~ '^[0-9a-f]{64}$'),
  trigger_proof_content_digest text NOT NULL CHECK (trigger_proof_content_digest ~ '^[0-9a-f]{64}$'),
  adjudicated_at_utc timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trader_guardian_protective_consumptions_v2_org_mandate_unique UNIQUE (organization_id, mandate_id)
);
--> statement-breakpoint
ALTER TABLE public.trader_guardian_protective_consumptions_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trader_guardian_protective_consumptions_v2_deny_authenticated_select
  ON public.trader_guardian_protective_consumptions_v2 FOR SELECT TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY trader_guardian_protective_consumptions_v2_deny_authenticated_insert
  ON public.trader_guardian_protective_consumptions_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_guardian_protective_consumptions_v2_deny_authenticated_update
  ON public.trader_guardian_protective_consumptions_v2 FOR UPDATE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE POLICY trader_guardian_protective_consumptions_v2_deny_authenticated_delete
  ON public.trader_guardian_protective_consumptions_v2 FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_guardian_protective_consumption_v2_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_guardian_protective_consumptions_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_guardian_protective_consumptions_v2_block_update
  BEFORE UPDATE ON public.trader_guardian_protective_consumptions_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_guardian_protective_consumption_v2_block_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_guardian_protective_consumptions_v2_block_delete
  BEFORE DELETE ON public.trader_guardian_protective_consumptions_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_guardian_protective_consumption_v2_block_mutation();
