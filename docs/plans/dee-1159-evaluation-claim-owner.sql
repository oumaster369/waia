-- DEE-1159 synthetic test draft only; no production journal number/apply authority.
-- After evaluation-source, issued-training and complete-family synthetic drafts.
ALTER TABLE public.trader_research_training_family_selections_v1
  ADD CONSTRAINT research_training_family_selection_receipt_tuple
  UNIQUE(organization_id,attempt_id,experiment_spec_sha256,receipt_sha256);
--> statement-breakpoint
CREATE TABLE public.trader_research_development_evaluation_claims_v1 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL,
  command_id text NOT NULL CHECK (command_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  attempt_id uuid NOT NULL,
  spec_sha256 text NOT NULL CHECK (spec_sha256 ~ '^[a-f0-9]{64}$'),
  hypothesis_id text NOT NULL CHECK (hypothesis_id ~ '^[a-f0-9]{64}$'),
  split text NOT NULL CHECK(split='validation'),
  selection_sha256 text NOT NULL CHECK(selection_sha256 ~ '^[a-f0-9]{64}$'),
  evaluation_source_id text NOT NULL,
  evaluation_source_digest text NOT NULL CHECK(evaluation_source_digest ~ '^[a-f0-9]{64}$'),
  receipt_canonical_json text NOT NULL CHECK(octet_length(receipt_canonical_json) BETWEEN 1 AND 262144),
  receipt_sha256 text NOT NULL CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'
    AND receipt_sha256=encode(sha256(convert_to(receipt_canonical_json,'UTF8')),'hex')),
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,claim_id),
  UNIQUE(organization_id,command_id),
  UNIQUE(spec_sha256,hypothesis_id,split),
  FOREIGN KEY(organization_id,attempt_id,spec_sha256,selection_sha256)
    REFERENCES public.trader_research_training_family_selections_v1
      (organization_id,attempt_id,experiment_spec_sha256,receipt_sha256) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,evaluation_source_id,evaluation_source_digest)
    REFERENCES public.trader_research_evaluation_source_runs_v1
      (organization_id,evaluation_source_id,content_digest) ON DELETE RESTRICT,
  FOREIGN KEY(spec_sha256,hypothesis_id,split)
    REFERENCES public.trader_strategy_admission_split_consume(spec_sha256,hypothesis_id,split) ON DELETE RESTRICT,
  CHECK((receipt_canonical_json::jsonb->>'schemaVersion'='waia.research.development-evaluation-claim.v1') IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'authority'='PRE_DISCLOSURE_VALIDATION_RESERVATION_ONLY') IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'organizationId'=organization_id::text) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'claimId'=claim_id::text) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'commandId'=command_id) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'attemptId'=attempt_id::text) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'experimentSpecSha256'=spec_sha256) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'hypothesisId'=hypothesis_id) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'split'=split) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'trainingFamilyReceiptSha256'=selection_sha256) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'evaluationSourceId'=evaluation_source_id) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->>'evaluationSourceIssuanceDigest'=evaluation_source_digest) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->'scientificQualified'='false'::jsonb) IS TRUE),
  CHECK((receipt_canonical_json::jsonb->'capitalEligible'='false'::jsonb) IS TRUE)
);
--> statement-breakpoint
CREATE TRIGGER research_evaluation_claim_no_mutation
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.trader_research_development_evaluation_claims_v1
  FOR EACH STATEMENT EXECUTE FUNCTION public.trader_research_source_append_only_v1();
--> statement-breakpoint
ALTER TABLE public.trader_research_development_evaluation_claims_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_research_development_evaluation_claims_v1 FROM PUBLIC,anon,authenticated;
