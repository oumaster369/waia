-- DEE-771: versioned append-only Knowledge authority.
-- Additive: does not rewrite 0192 or 0201. Strengthens immutability of
-- trader_knowledge_edges and trader_market_predictions for every relation kind
-- and every non-owner role. Existing edge/prediction rows remain history.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trader_knowledge_edge_version_v2 (
  id uuid PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  knowledge_edge_id uuid NOT NULL REFERENCES public.trader_knowledge_edges(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  version integer NOT NULL,
  from_ref text NOT NULL,
  to_ref text NOT NULL,
  relation_kind text NOT NULL,
  confidence text NOT NULL,
  strength text NOT NULL,
  regime_scope text NOT NULL,
  failure_cases_json text NOT NULL,
  hypothesis_id uuid,
  verified boolean NOT NULL,
  lifecycle_state text NOT NULL,
  reason_class text NOT NULL,
  content_digest_hex text NOT NULL,
  produced_by_receipt_digest_hex text NOT NULL,
  supersedes_version_id uuid,
  pit_event_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  schema_version text NOT NULL,
  CONSTRAINT trader_knowledge_edge_version_v2_id_organization_unique UNIQUE (id, organization_id),
  CONSTRAINT tkev2_content_digest_hex_check CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tkev2_receipt_digest_hex_check CHECK (produced_by_receipt_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tkev2_version_positive_check CHECK (version > 0),
  CONSTRAINT tkev2_reason_class_check CHECK (
    reason_class IN (
      'INITIAL_ASSERTION',
      'EVIDENCE_ONLY_ZERO_DELTA',
      'QUALIFIED_VERDICT_UPDATE',
      'OPERATOR_GOVERNED_CORRECTION',
      'SUPERSEDED_BY_VERSION',
      'RETIRED'
    )
  ),
  CONSTRAINT tkev2_lifecycle_check CHECK (lifecycle_state IN ('ACTIVE', 'RETIRED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tkev2_edge_version_uq
  ON public.trader_knowledge_edge_version_v2 (organization_id, knowledge_edge_id, version);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tkev2_edge_digest_reason_uq
  ON public.trader_knowledge_edge_version_v2 (
    organization_id, knowledge_edge_id, content_digest_hex, reason_class
  );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trader_market_prediction_verification_v2 (
  id uuid PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  prediction_id uuid NOT NULL REFERENCES public.trader_market_predictions(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  version integer NOT NULL,
  outcome_json text NOT NULL,
  verification_result text NOT NULL,
  verified_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  content_digest_hex text NOT NULL,
  produced_by_receipt_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  CONSTRAINT trader_market_prediction_verification_v2_id_organization_unique UNIQUE (id, organization_id),
  CONSTRAINT tmpv2_content_digest_hex_check CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmpv2_receipt_digest_hex_check CHECK (produced_by_receipt_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmpv2_version_positive_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tmpv2_prediction_version_uq
  ON public.trader_market_prediction_verification_v2 (organization_id, prediction_id, version);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tmpv2_prediction_digest_uq
  ON public.trader_market_prediction_verification_v2 (
    organization_id, prediction_id, content_digest_hex
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trader_knowledge_authority_block_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_knowledge_edges_immutable_all_v2 ON public.trader_knowledge_edges;
CREATE TRIGGER trader_knowledge_edges_immutable_all_v2
  BEFORE UPDATE OR DELETE ON public.trader_knowledge_edges
  FOR EACH ROW EXECUTE FUNCTION public.trader_knowledge_authority_block_mutation_v2();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_market_predictions_immutable_all_v2 ON public.trader_market_predictions;
CREATE TRIGGER trader_market_predictions_immutable_all_v2
  BEFORE UPDATE OR DELETE ON public.trader_market_predictions
  FOR EACH ROW EXECUTE FUNCTION public.trader_knowledge_authority_block_mutation_v2();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_knowledge_edge_version_v2_block_mutation
  ON public.trader_knowledge_edge_version_v2;
CREATE TRIGGER trader_knowledge_edge_version_v2_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_knowledge_edge_version_v2
  FOR EACH ROW EXECUTE FUNCTION public.trader_knowledge_authority_block_mutation_v2();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_market_prediction_verification_v2_block_mutation
  ON public.trader_market_prediction_verification_v2;
CREATE TRIGGER trader_market_prediction_verification_v2_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_market_prediction_verification_v2
  FOR EACH ROW EXECUTE FUNCTION public.trader_knowledge_authority_block_mutation_v2();
--> statement-breakpoint
INSERT INTO public.trader_knowledge_edge_version_v2 (
  id, organization_id, knowledge_edge_id, version,
  from_ref, to_ref, relation_kind, confidence, strength, regime_scope,
  failure_cases_json, hypothesis_id, verified, lifecycle_state, reason_class,
  content_digest_hex, produced_by_receipt_digest_hex, supersedes_version_id,
  pit_event_at, recorded_at, schema_version
)
SELECT
  gen_random_uuid(),
  e.organization_id,
  e.id,
  1,
  e.from_ref,
  e.to_ref,
  e.relation_kind,
  e.confidence,
  e.strength,
  e.regime_scope,
  e.failure_cases_json,
  e.hypothesis_id,
  e.verified,
  'ACTIVE',
  'INITIAL_ASSERTION',
  encode(sha256(convert_to(
    concat_ws('|', e.id::text, e.confidence, e.verified::text, e.relation_kind),
    'utf8'
  )), 'hex'),
  encode(sha256(convert_to(
    concat_ws('|', e.id::text, e.confidence, e.verified::text, e.relation_kind),
    'utf8'
  )), 'hex'),
  NULL,
  e.created_at,
  e.created_at,
  'knowledge-edge-version/v2'
FROM public.trader_knowledge_edges e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.trader_knowledge_edge_version_v2 v
  WHERE v.knowledge_edge_id = e.id
    AND v.organization_id = e.organization_id
);
--> statement-breakpoint
INSERT INTO public.trader_market_prediction_verification_v2 (
  id, organization_id, prediction_id, version, outcome_json, verification_result,
  verified_at, recorded_at, content_digest_hex, produced_by_receipt_digest_hex, schema_version
)
SELECT
  gen_random_uuid(),
  p.organization_id,
  p.id,
  1,
  p.outcome_json,
  p.verification_result,
  p.verified_at,
  p.verified_at,
  encode(sha256(convert_to(concat_ws('|', p.id::text, p.verification_result), 'utf8')), 'hex'),
  encode(sha256(convert_to(concat_ws('|', p.id::text, p.verification_result), 'utf8')), 'hex'),
  'market-prediction-verification/v2'
FROM public.trader_market_predictions p
WHERE p.verified_at IS NOT NULL
  AND p.outcome_json IS NOT NULL
  AND p.verification_result IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.trader_market_prediction_verification_v2 v
    WHERE v.prediction_id = p.id
      AND v.organization_id = p.organization_id
  );
--> statement-breakpoint
DROP POLICY IF EXISTS waia_historical_proposal_exact_update_v2 ON public.trader_knowledge_edges;
DROP POLICY IF EXISTS waia_historical_proposal_exact_update_v2 ON public.trader_market_predictions;
--> statement-breakpoint
REVOKE UPDATE (
  confidence, strength, regime_scope, failure_cases_json, hypothesis_id, verified, updated_at
) ON TABLE public.trader_knowledge_edges FROM waia_historical_runner;
REVOKE UPDATE (
  outcome_json, verification_result, verified_at
) ON TABLE public.trader_market_predictions FROM waia_historical_runner;
--> statement-breakpoint
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT DISTINCT grantee
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name IN ('trader_knowledge_edges', 'trader_market_predictions')
      AND privilege_type IN ('UPDATE', 'DELETE')
      AND grantee NOT IN ('postgres', CURRENT_USER)
  LOOP
    EXECUTE format(
      'REVOKE UPDATE, DELETE ON TABLE public.trader_knowledge_edges FROM %I',
      rec.grantee
    );
    EXECUTE format(
      'REVOKE UPDATE, DELETE ON TABLE public.trader_market_predictions FROM %I',
      rec.grantee
    );
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE public.trader_knowledge_edge_version_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_market_prediction_verification_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS trader_knowledge_edge_version_v2_deny_authenticated_select
  ON public.trader_knowledge_edge_version_v2;
CREATE POLICY trader_knowledge_edge_version_v2_deny_authenticated_select
  ON public.trader_knowledge_edge_version_v2 FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_knowledge_edge_version_v2_deny_authenticated_insert
  ON public.trader_knowledge_edge_version_v2;
CREATE POLICY trader_knowledge_edge_version_v2_deny_authenticated_insert
  ON public.trader_knowledge_edge_version_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_knowledge_edge_version_v2_deny_authenticated_update
  ON public.trader_knowledge_edge_version_v2;
CREATE POLICY trader_knowledge_edge_version_v2_deny_authenticated_update
  ON public.trader_knowledge_edge_version_v2 FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_knowledge_edge_version_v2_deny_authenticated_delete
  ON public.trader_knowledge_edge_version_v2;
CREATE POLICY trader_knowledge_edge_version_v2_deny_authenticated_delete
  ON public.trader_knowledge_edge_version_v2 FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS trader_market_prediction_verification_v2_deny_authenticated_select
  ON public.trader_market_prediction_verification_v2;
CREATE POLICY trader_market_prediction_verification_v2_deny_authenticated_select
  ON public.trader_market_prediction_verification_v2 FOR SELECT TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_prediction_verification_v2_deny_authenticated_insert
  ON public.trader_market_prediction_verification_v2;
CREATE POLICY trader_market_prediction_verification_v2_deny_authenticated_insert
  ON public.trader_market_prediction_verification_v2 FOR INSERT TO authenticated, anon WITH CHECK (false);
DROP POLICY IF EXISTS trader_market_prediction_verification_v2_deny_authenticated_update
  ON public.trader_market_prediction_verification_v2;
CREATE POLICY trader_market_prediction_verification_v2_deny_authenticated_update
  ON public.trader_market_prediction_verification_v2 FOR UPDATE TO authenticated, anon USING (false);
DROP POLICY IF EXISTS trader_market_prediction_verification_v2_deny_authenticated_delete
  ON public.trader_market_prediction_verification_v2;
CREATE POLICY trader_market_prediction_verification_v2_deny_authenticated_delete
  ON public.trader_market_prediction_verification_v2 FOR DELETE TO authenticated, anon USING (false);
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.trader_knowledge_edge_version_v2 TO waia_historical_runner;
GRANT SELECT, INSERT ON TABLE public.trader_market_prediction_verification_v2 TO waia_historical_runner;
--> statement-breakpoint
DROP POLICY IF EXISTS waia_historical_runner_org_select_v2
  ON public.trader_knowledge_edge_version_v2;
CREATE POLICY waia_historical_runner_org_select_v2
  ON public.trader_knowledge_edge_version_v2 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2
  ON public.trader_knowledge_edge_version_v2;
CREATE POLICY waia_historical_runner_org_insert_v2
  ON public.trader_knowledge_edge_version_v2 FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
DROP POLICY IF EXISTS waia_historical_runner_org_select_v2
  ON public.trader_market_prediction_verification_v2;
CREATE POLICY waia_historical_runner_org_select_v2
  ON public.trader_market_prediction_verification_v2 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2
  ON public.trader_market_prediction_verification_v2;
CREATE POLICY waia_historical_runner_org_insert_v2
  ON public.trader_market_prediction_verification_v2 FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE public.trader_knowledge_edge_version_v2 FROM waia_historical_runner;
REVOKE UPDATE, DELETE ON TABLE public.trader_market_prediction_verification_v2 FROM waia_historical_runner;
REVOKE UPDATE, DELETE ON TABLE public.trader_knowledge_edges FROM waia_historical_runner;
REVOKE UPDATE, DELETE ON TABLE public.trader_market_predictions FROM waia_historical_runner;
