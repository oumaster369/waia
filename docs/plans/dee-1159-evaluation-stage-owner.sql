-- DEE-1159 synthetic native-proof draft only. NOT a production migration.
-- Apply after evaluation-source, issued training/family and evaluation-claim drafts.
ALTER TABLE public.trader_research_development_evaluation_claims_v1
  ADD CONSTRAINT research_evaluation_claim_receipt_tuple UNIQUE(organization_id,claim_id,receipt_sha256);
--> statement-breakpoint
CREATE TABLE public.trader_research_development_evaluation_scopes_v1 (
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  claim_digest text NOT NULL,
  stage_ordinal integer NOT NULL CHECK(stage_ordinal BETWEEN 0 AND 1024),
  stage_run_id uuid NOT NULL,
  account_key text NOT NULL CHECK(account_key='research-evaluation-stage:'||stage_run_id::text),
  scope_canonical_json text NOT NULL CHECK(octet_length(scope_canonical_json) BETWEEN 1 AND 262144),
  scope_sha256 text NOT NULL CHECK(scope_sha256 ~ '^[a-f0-9]{64}$'
    AND scope_sha256=encode(sha256(convert_to(scope_canonical_json,'UTF8')),'hex')),
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,claim_id,stage_ordinal),
  UNIQUE(organization_id,stage_run_id),
  UNIQUE(organization_id,account_key),
  UNIQUE(organization_id,claim_id,stage_ordinal,stage_run_id),
  FOREIGN KEY(organization_id,claim_id,claim_digest)
    REFERENCES public.trader_research_development_evaluation_claims_v1
      (organization_id,claim_id,receipt_sha256) ON DELETE RESTRICT,
  CHECK((scope_canonical_json::jsonb->>'schemaVersion'='waia.research.development-evaluation-stage.v1') IS TRUE),
  CHECK((scope_canonical_json::jsonb->>'organizationId'=organization_id::text) IS TRUE),
  CHECK((scope_canonical_json::jsonb->>'claimId'=claim_id::text) IS TRUE),
  CHECK((scope_canonical_json::jsonb->>'claimDigest'=claim_digest) IS TRUE),
  CHECK((scope_canonical_json::jsonb->>'stageOrdinal'=stage_ordinal::text) IS TRUE),
  CHECK((scope_canonical_json::jsonb->>'stageKind'=CASE WHEN stage_ordinal=0 THEN 'VALIDATION' ELSE 'WALK_FORWARD' END) IS TRUE),
  CHECK((scope_canonical_json::jsonb->>'windowIndex'=greatest(0,stage_ordinal-1)::text) IS TRUE)
);
--> statement-breakpoint
CREATE TABLE public.trader_research_development_evaluation_results_v1 (
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  stage_ordinal integer NOT NULL,
  stage_run_id uuid NOT NULL,
  trace_canonical_json text NOT NULL CHECK(octet_length(trace_canonical_json) BETWEEN 1 AND 33554432),
  trace_sha256 text NOT NULL CHECK(trace_sha256 ~ '^[a-f0-9]{64}$'
    AND trace_sha256=encode(sha256(convert_to(trace_canonical_json,'UTF8')),'hex')),
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,claim_id,stage_ordinal),
  FOREIGN KEY(organization_id,claim_id,stage_ordinal,stage_run_id)
    REFERENCES public.trader_research_development_evaluation_scopes_v1
      (organization_id,claim_id,stage_ordinal,stage_run_id) ON DELETE RESTRICT,
  CHECK((trace_canonical_json::jsonb->>'schemaVersion'='waia.research.development-evaluation-stage.v1') IS TRUE),
  CHECK((trace_canonical_json::jsonb->>'authority'='EVALUATION_ENGINEERING_TRACE_ONLY') IS TRUE),
  CHECK((trace_canonical_json::jsonb->>'organizationId'=organization_id::text) IS TRUE),
  CHECK((trace_canonical_json::jsonb->>'claimId'=claim_id::text) IS TRUE),
  CHECK((trace_canonical_json::jsonb->>'stageOrdinal'=stage_ordinal::text) IS TRUE),
  CHECK((trace_canonical_json::jsonb->>'stageRunId'=stage_run_id::text) IS TRUE),
  CHECK((trace_canonical_json::jsonb->'scientificQualified'='false'::jsonb) IS TRUE),
  CHECK((trace_canonical_json::jsonb->'capitalEligible'='false'::jsonb) IS TRUE)
);
--> statement-breakpoint
CREATE TRIGGER research_evaluation_scope_no_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.trader_research_development_evaluation_scopes_v1
  FOR EACH STATEMENT EXECUTE FUNCTION public.trader_research_source_append_only_v1();
--> statement-breakpoint
CREATE TRIGGER research_evaluation_result_no_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.trader_research_development_evaluation_results_v1
  FOR EACH STATEMENT EXECUTE FUNCTION public.trader_research_source_append_only_v1();
--> statement-breakpoint
ALTER TABLE public.trader_research_development_evaluation_scopes_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_research_development_evaluation_results_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_research_development_evaluation_scopes_v1,
  public.trader_research_development_evaluation_results_v1 FROM PUBLIC,anon,authenticated;
