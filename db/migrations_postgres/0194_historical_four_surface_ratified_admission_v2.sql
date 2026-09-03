-- DEE-919: append-only human-ratified four-surface ScientificAdmission authority.
-- This table composes four already-durable WF_PREDICTIVE ScientificAdmission V2
-- receipts and seals the exact pre-run knowledge rows ratified in the same transaction.
-- It does not create or infer PredictiveTerminal from caller-supplied data.

CREATE TABLE public.trader_historical_four_surface_ratified_admission_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  release_sha text NOT NULL,
  aggregate_admission_receipt_id uuid NOT NULL,
  aggregate_admission_content_digest_hex text NOT NULL,
  development_dataset_identity_digest_hex text NOT NULL,
  operator_user_id uuid NOT NULL,
  surface_admissions_json jsonb NOT NULL,
  knowledge_snapshots_json jsonb NOT NULL,
  knowledge_snapshot_digest_hex text NOT NULL,
  market_evidence_json jsonb NOT NULL,
  market_evidence_digest_hex text NOT NULL,
  authority_json jsonb NOT NULL,
  authority_content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT historical_four_surface_ratified_admission_v2_natural
    UNIQUE (organization_id, run_id),
  CONSTRAINT historical_four_surface_ratified_admission_v2_full_lineage
    UNIQUE (id, organization_id, run_id, authority_content_digest_hex),
  CONSTRAINT historical_four_surface_ratified_admission_v2_aggregate_fk
    FOREIGN KEY (aggregate_admission_receipt_id, organization_id,
      aggregate_admission_content_digest_hex)
    REFERENCES public.trader_scientific_admission_receipt_v1
      (id, organization_id, content_digest),
  CONSTRAINT historical_four_surface_ratified_admission_v2_operator_fk
    FOREIGN KEY (operator_user_id) REFERENCES public.users(id) ON DELETE RESTRICT,
  CONSTRAINT historical_four_surface_ratified_admission_v2_schema CHECK (
    schema_version = 'waia.trader.historical_four_surface_ratified_admission.v2'
  ),
  CONSTRAINT historical_four_surface_ratified_admission_v2_digests CHECK (
    release_sha ~ '^[0-9a-f]{40}$' AND
    aggregate_admission_content_digest_hex ~ '^[0-9a-f]{64}$' AND
    development_dataset_identity_digest_hex ~ '^[0-9a-f]{64}$' AND
    knowledge_snapshot_digest_hex ~ '^[0-9a-f]{64}$' AND
    market_evidence_digest_hex ~ '^[0-9a-f]{64}$' AND
    authority_content_digest_hex ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT historical_four_surface_ratified_admission_v2_json_binding CHECK ((
    jsonb_typeof(surface_admissions_json) = 'array' AND
    jsonb_array_length(surface_admissions_json) = 4 AND
    jsonb_typeof(knowledge_snapshots_json) = 'array' AND
    jsonb_array_length(knowledge_snapshots_json) = 4 AND
    jsonb_typeof(market_evidence_json) = 'array' AND
    jsonb_array_length(market_evidence_json) = 2 AND
    authority_json ->> 'schemaVersion' = schema_version AND
    authority_json ->> 'organizationId' = organization_id::text AND
    authority_json ->> 'runId' = run_id AND
    authority_json ->> 'releaseSha' = release_sha AND
    authority_json ->> 'aggregateAdmissionReceiptId' = aggregate_admission_receipt_id::text AND
    authority_json ->> 'aggregateAdmissionContentDigestHex' =
      aggregate_admission_content_digest_hex AND
    authority_json ->> 'developmentDatasetIdentityDigestHex' =
      development_dataset_identity_digest_hex AND
    authority_json ->> 'operatorUserId' = operator_user_id::text AND
    authority_json -> 'surfaceAdmissions' = surface_admissions_json AND
    authority_json -> 'knowledgeSnapshots' = knowledge_snapshots_json AND
    authority_json ->> 'knowledgeSnapshotDigestHex' = knowledge_snapshot_digest_hex AND
    authority_json -> 'marketEvidence' = market_evidence_json AND
    authority_json ->> 'marketEvidenceDigestHex' = market_evidence_digest_hex AND
    (authority_json ->> 'epistemicRecordCutoff')::timestamptz = created_at AND
    authority_json ->> 'contentDigestHex' = authority_content_digest_hex AND
    authority_json -> 'authorityBoundary' = jsonb_build_object(
      'capitalAuthority', 'NONE',
      'liveTradingAuthority', 'NONE',
      'blindHoldoutAuthority', 'FORBIDDEN_NOT_PRESENT_NOT_ACCESSED'
    )
  ) IS TRUE)
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.waia_historical_four_surface_ratified_admission_v2_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trader_historical_four_surface_ratified_admission_v2 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER historical_four_surface_ratified_admission_v2_block_update
  BEFORE UPDATE ON public.trader_historical_four_surface_ratified_admission_v2
  FOR EACH ROW EXECUTE FUNCTION
    public.waia_historical_four_surface_ratified_admission_v2_block_mutation();
--> statement-breakpoint
CREATE TRIGGER historical_four_surface_ratified_admission_v2_block_delete
  BEFORE DELETE ON public.trader_historical_four_surface_ratified_admission_v2
  FOR EACH ROW EXECUTE FUNCTION
    public.waia_historical_four_surface_ratified_admission_v2_block_mutation();
--> statement-breakpoint

ALTER TABLE public.trader_historical_four_surface_ratified_admission_v2
  ENABLE ROW LEVEL SECURITY;
CREATE POLICY historical_four_surface_ratified_admission_v2_deny_browser
  ON public.trader_historical_four_surface_ratified_admission_v2
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY historical_four_surface_ratified_admission_v2_runner_read
  ON public.trader_historical_four_surface_ratified_admission_v2
  FOR SELECT TO PUBLIC USING (
    current_user = 'waia_historical_runner' AND
    organization_id = '3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
  );
--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE
  public.trader_historical_four_surface_ratified_admission_v2
FROM waia_historical_runner;
GRANT SELECT ON TABLE
  public.trader_historical_four_surface_ratified_admission_v2
TO waia_historical_runner;
