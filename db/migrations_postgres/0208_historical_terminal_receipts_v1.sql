-- DEE-1006: append-only scientific-refusal and rehearsal-started terminal receipts.
-- Sibling tables: trader_scientific_admission_receipt_v1 remains ADMITTED-only.
-- CHECK cannot contain subqueries; identity-set validation lives in this IMMUTABLE helper.
CREATE FUNCTION public.waia_historical_refusal_comparison_identities_valid_v1(identities jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(identities) = 'array'
    AND jsonb_array_length(identities) = 20
    AND (
      SELECT count(DISTINCT (value ->> 'surfaceKey') || ':' || (value ->> 'baselineId'))
      FROM jsonb_array_elements(identities) value
    ) = 20
    AND (
      SELECT count(*)
      FROM jsonb_array_elements(identities) value
      WHERE (value ->> 'surfaceKey') IN ('BTCUSDT:30','BTCUSDT:60','ETHUSDT:30','ETHUSDT:60')
        AND (value ->> 'baselineId') IN (
          'climatology/v1','gaussian-pop-std/v2','student-t5-nu5/v1',
          'rolling-w2000/v1','ewma-lambda094/v3')
        AND (value ->> 'comparisonIdentityDigestHex') ~ '^[0-9a-f]{64}$'
    ) = 20
$$;
--> statement-breakpoint
CREATE TABLE public.trader_historical_scientific_admission_refusal_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  release_sha text NOT NULL,
  runtime_release_binding_receipt_digest_hex text NOT NULL,
  reason_code text NOT NULL,
  coverage_digest_hex text NOT NULL,
  holm_family_pass boolean NOT NULL,
  receipt_json jsonb NOT NULL,
  content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_id),
  UNIQUE (id, organization_id, run_id, content_digest_hex),
  CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  CHECK (runtime_release_binding_receipt_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (coverage_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (schema_version = 'waia.trader.historical_scientific_admission_refusal.v1'),
  CHECK (reason_code IN (
    'HOLM_FWER_FAIL','BRIER_GATE_FAIL','COVERAGE_INCOMPLETE',
    'MISSING_PROPOSAL','MISSING_RATIFICATION','MISSING_FOUR_SURFACE_AUTHORITY',
    'RELEASE_MISMATCH','CONCURRENT_CLAIMANT','WRONG_LIFECYCLE','HEALTH_MISMATCH',
    'MISSING_ADMIN_OBSERVATION','MISSING_TENANT_OBSERVATION','CROSS_RUN_OBSERVATION',
    'FIXTURE_IDENTITY','UNAUTHENTICATED_OBSERVATION','OBSERVATION_ADAPTER_MISSING',
    'ORGANIZATION_SCOPE')),
  CHECK ((receipt_json ->> 'schemaVersion') = schema_version),
  CHECK ((receipt_json ->> 'organizationId') = organization_id::text),
  CHECK ((receipt_json ->> 'runId') = run_id),
  CHECK ((receipt_json ->> 'releaseSha') = release_sha),
  CHECK ((receipt_json ->> 'runtimeReleaseBindingReceiptDigestHex') =
    runtime_release_binding_receipt_digest_hex),
  CHECK ((receipt_json ->> 'reasonCode') = reason_code),
  CHECK ((receipt_json ->> 'contentDigestHex') = content_digest_hex),
  CHECK ((receipt_json -> 'coverage' ->> 'coverageDigestHex') = coverage_digest_hex),
  CHECK (((receipt_json -> 'coverage' ->> 'resampleOrdinalStartInclusive')::integer) = 0),
  CHECK (((receipt_json -> 'coverage' ->> 'resampleOrdinalEndExclusive')::integer) = 10000),
  CHECK ((receipt_json -> 'holmFwer' ->> 'familyPass')::boolean IS NOT DISTINCT FROM holm_family_pass),
  CHECK (jsonb_typeof(receipt_json -> 'surfaces') = 'array'
    AND jsonb_array_length(receipt_json -> 'surfaces') = 4),
  CHECK (public.waia_historical_refusal_comparison_identities_valid_v1(
    receipt_json -> 'comparisonIdentities') IS TRUE),
  CHECK (jsonb_typeof(receipt_json -> 'statistics' -> 'comparisons') = 'array'
    AND jsonb_array_length(receipt_json -> 'statistics' -> 'comparisons') = 20),
  CHECK (jsonb_typeof(receipt_json -> 'holmFwer' -> 'results') = 'array'
    AND jsonb_array_length(receipt_json -> 'holmFwer' -> 'results') = 20),
  CHECK (content_digest_hex = encode(sha256(convert_to(
    public.waia_canonical_jsonb_v1(receipt_json - 'contentDigestHex'::text),'UTF8')),'hex'))
);
--> statement-breakpoint
CREATE TABLE public.trader_historical_rehearsal_started_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  run_id text NOT NULL,
  release_sha text NOT NULL,
  runtime_release_binding_receipt_digest_hex text NOT NULL,
  proposal_id uuid NOT NULL,
  proposal_content_digest_hex text NOT NULL,
  ratification_id uuid NOT NULL,
  ratification_content_digest_hex text NOT NULL,
  four_surface_authority_id uuid NOT NULL,
  four_surface_authority_content_digest_hex text NOT NULL,
  consumer_claim_digest_hex text NOT NULL,
  lease_digest_hex text NOT NULL,
  lifecycle_content_digest_hex text NOT NULL,
  image_health_binding_digest_hex text NOT NULL,
  admin_observation_binding_digest_hex text NOT NULL,
  tenant_observation_binding_digest_hex text NOT NULL,
  receipt_json jsonb NOT NULL,
  content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_id),
  UNIQUE (id, organization_id, run_id, content_digest_hex),
  FOREIGN KEY (proposal_id, organization_id, run_id, proposal_content_digest_hex)
    REFERENCES public.trader_historical_technical_proposal_v2
      (id, organization_id, run_id, content_digest_hex),
  FOREIGN KEY (ratification_id)
    REFERENCES public.trader_historical_proposal_ratification_v2 (id),
  FOREIGN KEY (four_surface_authority_id, organization_id, run_id,
      four_surface_authority_content_digest_hex)
    REFERENCES public.trader_historical_four_surface_ratified_admission_v2
      (id, organization_id, run_id, authority_content_digest_hex),
  CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  CHECK (runtime_release_binding_receipt_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (proposal_content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (ratification_content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (four_surface_authority_content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (consumer_claim_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (lease_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (lifecycle_content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (image_health_binding_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (admin_observation_binding_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (tenant_observation_binding_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (schema_version = 'waia.trader.historical_rehearsal_started.v1'),
  CHECK ((receipt_json ->> 'schemaVersion') = schema_version),
  CHECK ((receipt_json ->> 'organizationId') = organization_id::text),
  CHECK ((receipt_json ->> 'accountId') = account_id),
  CHECK ((receipt_json ->> 'runId') = run_id),
  CHECK ((receipt_json ->> 'releaseSha') = release_sha),
  CHECK ((receipt_json ->> 'runtimeReleaseBindingReceiptDigestHex') =
    runtime_release_binding_receipt_digest_hex),
  CHECK ((receipt_json ->> 'proposalId') = proposal_id::text),
  CHECK ((receipt_json ->> 'proposalContentDigestHex') = proposal_content_digest_hex),
  CHECK ((receipt_json ->> 'ratificationId') = ratification_id::text),
  CHECK ((receipt_json ->> 'ratificationContentDigestHex') = ratification_content_digest_hex),
  CHECK ((receipt_json ->> 'fourSurfaceAuthorityId') = four_surface_authority_id::text),
  CHECK ((receipt_json ->> 'fourSurfaceAuthorityContentDigestHex') =
    four_surface_authority_content_digest_hex),
  CHECK ((receipt_json -> 'consumerClaim' ->> 'contentDigestHex') = consumer_claim_digest_hex),
  CHECK ((receipt_json -> 'lease' ->> 'contentDigestHex') = lease_digest_hex),
  CHECK ((receipt_json -> 'lifecycle' ->> 'contentDigestHex') = lifecycle_content_digest_hex),
  CHECK ((receipt_json -> 'imageHealthBinding' ->> 'contentDigestHex') =
    image_health_binding_digest_hex),
  CHECK ((receipt_json -> 'adminObservationBinding' ->> 'contentDigestHex') =
    admin_observation_binding_digest_hex),
  CHECK ((receipt_json -> 'tenantObservationBinding' ->> 'contentDigestHex') =
    tenant_observation_binding_digest_hex),
  CHECK ((receipt_json ->> 'contentDigestHex') = content_digest_hex),
  CHECK ((receipt_json -> 'lifecycle' ->> 'phase') IN ('RUNNING','COMPLETED')),
  CHECK ((receipt_json -> 'imageHealthBinding' ->> 'releaseSha') = release_sha),
  CHECK ((receipt_json -> 'imageHealthBinding' ->> 'imageReleaseSha') = release_sha),
  CHECK ((receipt_json -> 'imageHealthBinding' ->> 'runId') = run_id),
  CHECK (content_digest_hex = encode(sha256(convert_to(
    public.waia_canonical_jsonb_v1(receipt_json - 'contentDigestHex'::text),'UTF8')),'hex'))
);
--> statement-breakpoint
CREATE TRIGGER historical_scientific_admission_refusal_v1_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_historical_scientific_admission_refusal_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
CREATE TRIGGER historical_rehearsal_started_v1_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_historical_rehearsal_started_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_historical_scientific_admission_refusal_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_historical_scientific_admission_refusal_v1 FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trader_historical_rehearsal_started_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_historical_rehearsal_started_v1 FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.trader_historical_scientific_admission_refusal_v1
  FROM PUBLIC, anon, authenticated, waia_historical_runner;
REVOKE ALL ON public.trader_historical_rehearsal_started_v1
  FROM PUBLIC, anon, authenticated, waia_historical_runner;
GRANT SELECT ON public.trader_historical_scientific_admission_refusal_v1 TO waia_historical_runner;
GRANT INSERT (organization_id, run_id, release_sha, runtime_release_binding_receipt_digest_hex,
  reason_code, coverage_digest_hex, holm_family_pass, receipt_json, content_digest_hex,
  schema_version)
  ON public.trader_historical_scientific_admission_refusal_v1 TO waia_historical_runner;
GRANT SELECT ON public.trader_historical_rehearsal_started_v1 TO waia_historical_runner;
GRANT INSERT (organization_id, account_id, run_id, release_sha,
  runtime_release_binding_receipt_digest_hex, proposal_id, proposal_content_digest_hex,
  ratification_id, ratification_content_digest_hex, four_surface_authority_id,
  four_surface_authority_content_digest_hex, consumer_claim_digest_hex, lease_digest_hex,
  lifecycle_content_digest_hex, image_health_binding_digest_hex,
  admin_observation_binding_digest_hex, tenant_observation_binding_digest_hex,
  receipt_json, content_digest_hex, schema_version)
  ON public.trader_historical_rehearsal_started_v1 TO waia_historical_runner;
CREATE POLICY historical_scientific_admission_refusal_v1_deny_browser
  ON public.trader_historical_scientific_admission_refusal_v1 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY historical_rehearsal_started_v1_deny_browser
  ON public.trader_historical_rehearsal_started_v1 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY historical_scientific_admission_refusal_v1_owner_read
  ON public.trader_historical_scientific_admission_refusal_v1 FOR SELECT
  USING (current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='public.trader_historical_scientific_admission_refusal_v1'::regclass));
CREATE POLICY historical_rehearsal_started_v1_owner_read
  ON public.trader_historical_rehearsal_started_v1 FOR SELECT
  USING (current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid='public.trader_historical_rehearsal_started_v1'::regclass));
CREATE POLICY historical_scientific_admission_refusal_v1_runner_read
  ON public.trader_historical_scientific_admission_refusal_v1 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_scientific_admission_refusal_v1_runner_insert
  ON public.trader_historical_scientific_admission_refusal_v1 FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_rehearsal_started_v1_runner_read
  ON public.trader_historical_rehearsal_started_v1 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_rehearsal_started_v1_runner_insert
  ON public.trader_historical_rehearsal_started_v1 FOR INSERT TO waia_historical_runner
  WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.trader_historical_technical_proposal_v2 proposal
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
        AND approval.organization_id=proposal.organization_id
        AND approval.run_id=proposal.run_id
        AND approval.proposal_content_digest_hex=proposal.content_digest_hex
        AND approval.release_sha=proposal.release_sha
      JOIN public.trader_historical_four_surface_ratified_admission_v2 authority
        ON authority.organization_id=proposal.organization_id
        AND authority.run_id=proposal.run_id
        AND authority.release_sha=proposal.release_sha
      WHERE proposal.organization_id=
          trader_historical_rehearsal_started_v1.organization_id
        AND proposal.run_id=trader_historical_rehearsal_started_v1.run_id
        AND proposal.id=trader_historical_rehearsal_started_v1.proposal_id
        AND proposal.content_digest_hex=
          trader_historical_rehearsal_started_v1.proposal_content_digest_hex
        AND proposal.release_sha=trader_historical_rehearsal_started_v1.release_sha
        AND approval.id=trader_historical_rehearsal_started_v1.ratification_id
        AND approval.content_digest_hex=
          trader_historical_rehearsal_started_v1.ratification_content_digest_hex
        AND authority.id=
          trader_historical_rehearsal_started_v1.four_surface_authority_id
        AND authority.authority_content_digest_hex=
          trader_historical_rehearsal_started_v1.four_surface_authority_content_digest_hex
    )
  );
