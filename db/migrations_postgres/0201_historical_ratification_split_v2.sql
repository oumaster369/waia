-- DEE-920: split execution-host evidence preparation from authenticated Human ratification.
-- The execution host may prepare a digest-sealed proposal, but only an authenticated Admin
-- session may create the approval row.  The runner may read, never create, Human approval.
CREATE TABLE public.trader_historical_ratification_request_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  release_sha text NOT NULL,
  operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  request_json jsonb NOT NULL,
  content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_id),
  UNIQUE (id, organization_id, run_id, content_digest_hex),
  CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (schema_version = 'waia.trader.historical_ratification_request.v2'),
  CHECK ((request_json ->> 'organizationId') = organization_id::text),
  CHECK ((request_json ->> 'runId') = run_id),
  CHECK ((request_json ->> 'releaseSha') = release_sha),
  CHECK ((request_json ->> 'operatorUserId') = operator_user_id::text),
  CHECK (((request_json -> 'executionExtent' ->> 'initialRecordIndex')::integer) >= 239),
  CHECK (((request_json -> 'executionExtent' ->> 'cycleCount')::integer) BETWEEN 1 AND 10000),
  CHECK ((request_json ->> 'contentDigestHex') = content_digest_hex)
  ,CHECK (content_digest_hex = encode(sha256(convert_to(
    public.waia_canonical_jsonb_v1(request_json - 'contentDigestHex'::text),'UTF8')),'hex'))
);
--> statement-breakpoint
-- Execution-host proof of the exact qualified WALK_FORWARD boundary.  This is
-- technical evidence only: it carries no Human, capital, live, or holdout authority.
-- Persisting the complete digest-sealed qualification receipt lets PostgreSQL derive
-- the economic extent instead of trusting duplicate runner-supplied counters.
CREATE OR REPLACE FUNCTION public.waia_historical_qualification_extent_matches_v2(
  receipt jsonb,
  first_economic integer,
  economic_count integer
) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, public
AS $fn$
  SELECT
    receipt->>'classification'='PRE_HOLDOUT_QUALIFICATION=PASS'
    AND receipt->>'qualificationMode'='OFFICIAL_PRE_HOLDOUT_REAL_DATA'
    AND receipt#>>'{holdout,status}'='PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED'
    AND receipt->'symbols'=jsonb_build_array('BTCUSDT','ETHUSDT')
    AND (SELECT count(*) FROM jsonb_array_elements(
      receipt->'scientificSubpartitions') value
      WHERE value->>'scientificPartition'='WF_PREDICTIVE')=2
    AND (SELECT count(DISTINCT (value->>'barCount')::integer)
      FROM jsonb_array_elements(receipt->'scientificSubpartitions') value
      WHERE value->>'scientificPartition'='WF_PREDICTIVE')=1
    AND first_economic=(SELECT min((value->>'barCount')::integer)
      FROM jsonb_array_elements(receipt->'scientificSubpartitions') value
      WHERE value->>'scientificPartition'='WF_PREDICTIVE')
    AND (SELECT count(*) FROM jsonb_array_elements(
      receipt->'scientificSubpartitions') value
      WHERE value->>'scientificPartition'='WF_ECONOMIC')=2
    AND (SELECT count(DISTINCT (value->>'barCount')::integer)
      FROM jsonb_array_elements(receipt->'scientificSubpartitions') value
      WHERE value->>'scientificPartition'='WF_ECONOMIC')=1
    AND economic_count=(SELECT min((value->>'barCount')::integer)
      FROM jsonb_array_elements(receipt->'scientificSubpartitions') value
      WHERE value->>'scientificPartition'='WF_ECONOMIC')
$fn$;
--> statement-breakpoint
CREATE TABLE public.trader_historical_qualified_execution_extent_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  release_sha text NOT NULL,
  qualification_receipt_digest_hex text NOT NULL,
  qualification_receipt_json jsonb NOT NULL,
  first_economic_record_index integer NOT NULL,
  economic_record_count integer NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, run_id),
  UNIQUE (organization_id, run_id, qualification_receipt_digest_hex),
  CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  CHECK (qualification_receipt_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (schema_version='waia.trader.historical_qualified_execution_extent.v2'),
  CHECK ((qualification_receipt_json->>'releaseSha')=release_sha),
  CHECK ((qualification_receipt_json->>'organizationId')=organization_id::text),
  CHECK ((qualification_receipt_json->>'qualificationReceiptDigest')=
    qualification_receipt_digest_hex),
  CHECK (qualification_receipt_digest_hex=encode(sha256(convert_to(
    public.waia_canonical_jsonb_v1(
      qualification_receipt_json-'qualificationReceiptDigest'),'UTF8')),'hex')),
  CHECK (first_economic_record_index >= 240),
  CHECK (economic_record_count >= 1),
  CHECK (public.waia_historical_qualification_extent_matches_v2(
    qualification_receipt_json,first_economic_record_index,economic_record_count))
);
--> statement-breakpoint
CREATE TABLE public.trader_historical_technical_proposal_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  release_sha text NOT NULL,
  request_id uuid NOT NULL,
  request_content_digest_hex text NOT NULL,
  technical_candidate_json jsonb NOT NULL,
  technical_candidate_content_digest_hex text NOT NULL,
  launch_plan_json jsonb NOT NULL,
  proposal_json jsonb NOT NULL,
  content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_id),
  UNIQUE (id, organization_id, run_id, content_digest_hex),
  FOREIGN KEY (request_id, organization_id, run_id, request_content_digest_hex)
    REFERENCES public.trader_historical_ratification_request_v2
      (id, organization_id, run_id, content_digest_hex),
  CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  CHECK (technical_candidate_content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (schema_version = 'waia.trader.historical_technical_proposal.v2'),
  CHECK ((technical_candidate_json ->> 'organizationId') = organization_id::text),
  CHECK ((technical_candidate_json ->> 'runId') = run_id),
  CHECK ((technical_candidate_json ->> 'releaseSha') = release_sha),
  CHECK ((technical_candidate_json ->> 'contentDigestHex') = technical_candidate_content_digest_hex),
  CHECK ((proposal_json ->> 'organizationId') = organization_id::text),
  CHECK ((proposal_json ->> 'runId') = run_id),
  CHECK ((proposal_json ->> 'releaseSha') = release_sha),
  CHECK ((proposal_json ->> 'requestId') = request_id::text),
  CHECK ((proposal_json ->> 'requestContentDigestHex') = request_content_digest_hex),
  CHECK ((proposal_json ->> 'technicalCandidateContentDigestHex') =
    technical_candidate_content_digest_hex),
  CONSTRAINT historical_proposal_displayed_candidate_matches_v2 CHECK (
    jsonb_typeof(technical_candidate_json) IS NOT DISTINCT FROM 'object'::text
    AND (proposal_json -> 'technicalCandidate') IS NOT DISTINCT FROM technical_candidate_json
  ),
  CHECK (((launch_plan_json ->> 'initialRecordIndex')::integer) >= 240),
  CHECK (((launch_plan_json ->> 'cycleCount')::integer) BETWEEN 1 AND 10000),
  CHECK ((proposal_json -> 'launchPlan') = launch_plan_json),
  CHECK ((proposal_json ->> 'contentDigestHex') = content_digest_hex)
  ,CHECK (technical_candidate_content_digest_hex = encode(sha256(convert_to(
    public.waia_canonical_jsonb_v1(technical_candidate_json - 'contentDigestHex'::text),'UTF8')),'hex'))
  ,CHECK (content_digest_hex = encode(sha256(convert_to(
    public.waia_canonical_jsonb_v1(proposal_json - 'contentDigestHex'::text),'UTF8')),'hex'))
);
--> statement-breakpoint
CREATE TABLE public.trader_historical_proposal_ratification_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  release_sha text NOT NULL,
  proposal_id uuid NOT NULL,
  proposal_content_digest_hex text NOT NULL,
  operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  ratification_json jsonb NOT NULL,
  content_digest_hex text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, run_id),
  FOREIGN KEY (proposal_id, organization_id, run_id, proposal_content_digest_hex)
    REFERENCES public.trader_historical_technical_proposal_v2
      (id, organization_id, run_id, content_digest_hex),
  CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  CHECK (content_digest_hex ~ '^[0-9a-f]{64}$'),
  CHECK (schema_version = 'waia.trader.historical_proposal_ratification.v2'),
  CHECK ((ratification_json ->> 'organizationId') = organization_id::text),
  CHECK ((ratification_json ->> 'runId') = run_id),
  CHECK ((ratification_json ->> 'releaseSha') = release_sha),
  CHECK ((ratification_json ->> 'proposalId') = proposal_id::text),
  CHECK ((ratification_json ->> 'proposalContentDigestHex') = proposal_content_digest_hex),
  CHECK ((ratification_json ->> 'operatorUserId') = operator_user_id::text),
  CHECK ((ratification_json ->> 'contentDigestHex') = content_digest_hex)
  ,CHECK (content_digest_hex = encode(sha256(convert_to(
    public.waia_canonical_jsonb_v1(ratification_json - 'contentDigestHex'::text),'UTF8')),'hex'))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_historical_ratification_split_v2_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_historical_technical_proposal_v2_bind_request_extent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE requested_extent jsonb; qualified_extent record;
BEGIN
  SELECT request_json->'executionExtent' INTO STRICT requested_extent
  FROM public.trader_historical_ratification_request_v2 WHERE id=NEW.request_id;
  IF requested_extent IS DISTINCT FROM NEW.launch_plan_json::jsonb -
      ARRAY['accountId','symbol','primaryHorizonMinutes','startingCashUsdt',
        'defaultQuantity']::text[] THEN
    RAISE EXCEPTION 'technical proposal execution extent differs from Human request'
      USING ERRCODE='check_violation';
  END IF;
  SELECT first_economic_record_index,economic_record_count INTO STRICT qualified_extent
  FROM public.trader_historical_qualified_execution_extent_v2
  WHERE organization_id=NEW.organization_id AND run_id=NEW.run_id
    AND release_sha=NEW.release_sha
    AND qualification_receipt_digest_hex=
      NEW.technical_candidate_json->>'qualificationReceiptDigestHex';
  IF (NEW.technical_candidate_json->>'firstEconomicRecordIndex')::integer IS DISTINCT FROM
      qualified_extent.first_economic_record_index
    OR (NEW.technical_candidate_json->>'economicRecordCount')::integer IS DISTINCT FROM
      qualified_extent.economic_record_count
    OR (NEW.launch_plan_json->>'initialRecordIndex')::integer <
      qualified_extent.first_economic_record_index
    OR (NEW.launch_plan_json->>'initialRecordIndex')::integer +
      (NEW.launch_plan_json->>'cycleCount')::integer >
      qualified_extent.first_economic_record_index + qualified_extent.economic_record_count THEN
    RAISE EXCEPTION 'technical proposal extent exceeds qualified WF_ECONOMIC partition'
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER historical_technical_proposal_v2_bind_request_extent
  BEFORE INSERT ON public.trader_historical_technical_proposal_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_technical_proposal_v2_bind_request_extent();
--> statement-breakpoint
CREATE TRIGGER historical_ratification_request_v2_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_historical_ratification_request_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
CREATE TRIGGER historical_qualified_execution_extent_v2_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_historical_qualified_execution_extent_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
CREATE TRIGGER historical_technical_proposal_v2_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_historical_technical_proposal_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
CREATE TRIGGER historical_proposal_ratification_v2_block_mutation
  BEFORE UPDATE OR DELETE ON public.trader_historical_proposal_ratification_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_historical_ratification_split_v2_block_mutation();
--> statement-breakpoint
-- Legacy execution rows predate historical run lineage.  Keep them NULL and require
-- complete, explicitly mock lineage for every new historical-run order.
ALTER TABLE public.trader_orders
  ADD COLUMN historical_run_id text,
  ADD COLUMN historical_account_key text,
  ADD CONSTRAINT trader_orders_historical_lineage_complete CHECK (
    (historical_run_id IS NULL AND historical_account_key IS NULL) OR
    (historical_run_id IS NOT NULL AND historical_account_key IS NOT NULL
      AND execution_mode='mock'::public.order_execution_mode)
  );
CREATE INDEX trader_orders_org_historical_run_account_idx
  ON public.trader_orders (organization_id,historical_run_id,historical_account_key)
  WHERE historical_run_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.trader_historical_ratification_request_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_historical_qualified_execution_extent_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_historical_technical_proposal_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trader_historical_proposal_ratification_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY historical_ratification_request_v2_deny_browser
  ON public.trader_historical_ratification_request_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY historical_qualified_execution_extent_v2_deny_browser
  ON public.trader_historical_qualified_execution_extent_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY historical_technical_proposal_v2_deny_browser
  ON public.trader_historical_technical_proposal_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY historical_proposal_ratification_v2_deny_browser
  ON public.trader_historical_proposal_ratification_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY historical_ratification_request_v2_runner_read
  ON public.trader_historical_ratification_request_v2 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_qualified_execution_extent_v2_runner_read
  ON public.trader_historical_qualified_execution_extent_v2 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_qualified_execution_extent_v2_runner_insert
  ON public.trader_historical_qualified_execution_extent_v2 FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_technical_proposal_v2_runner_read
  ON public.trader_historical_technical_proposal_v2 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_technical_proposal_v2_runner_insert
  ON public.trader_historical_technical_proposal_v2 FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
CREATE POLICY historical_proposal_ratification_v2_runner_read
  ON public.trader_historical_proposal_ratification_v2 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid);
--> statement-breakpoint
-- The execution role must not enumerate organization membership.  The only
-- membership fact it needs is whether the exact operator already bound by an
-- exact durable request/proposal/approval is still an owner or manager.
CREATE OR REPLACE FUNCTION public.waia_historical_approved_operator_role_v2(
  p_organization_id uuid,
  p_run_id text,
  p_release_sha text,
  p_operator_user_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT member.member_role::text
  FROM public.trader_historical_ratification_request_v2 request
  JOIN public.trader_historical_technical_proposal_v2 proposal
    ON proposal.request_id=request.id
   AND proposal.organization_id=request.organization_id
   AND proposal.run_id=request.run_id
   AND proposal.release_sha=request.release_sha
   AND proposal.request_content_digest_hex=request.content_digest_hex
  JOIN public.trader_historical_proposal_ratification_v2 approval
    ON approval.proposal_id=proposal.id
   AND approval.organization_id=proposal.organization_id
   AND approval.run_id=proposal.run_id
   AND approval.release_sha=proposal.release_sha
   AND approval.proposal_content_digest_hex=proposal.content_digest_hex
  JOIN public.organization_members member
    ON member.organization_id=approval.organization_id
   AND member.user_id=approval.operator_user_id
  WHERE request.organization_id=p_organization_id
    AND p_organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND request.run_id=p_run_id
    AND request.release_sha=p_release_sha
    AND request.operator_user_id=p_operator_user_id
    AND approval.operator_user_id=p_operator_user_id
    AND member.member_role IN ('owner','manager')
    AND request.request_json::jsonb->>'contentDigestHex'=request.content_digest_hex
    AND proposal.proposal_json::jsonb->>'contentDigestHex'=proposal.content_digest_hex
    AND approval.ratification_json::jsonb->>'contentDigestHex'=approval.content_digest_hex
  LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.waia_historical_approved_operator_role_v2(
  uuid,text,text,uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waia_historical_approved_operator_role_v2(
  uuid,text,text,uuid
) TO waia_historical_runner;
-- Migration 0199 granted an organization-wide membership projection.  Remove
-- both the grant and its RLS policy now that the exact approval-bound helper
-- exists.
DROP POLICY IF EXISTS waia_historical_runner_org_select_v2
  ON public.organization_members;
REVOKE ALL PRIVILEGES ON TABLE public.organization_members
  FROM waia_historical_runner;
--> statement-breakpoint
-- The immutable final authority is readable by the runner only after the exact
-- proposal digest has an authenticated Admin ratification.  A plain
-- organization-wide read policy from 0199/0194 would over-authorize unrelated
-- or not-yet-approved runs.
DROP POLICY IF EXISTS waia_historical_runner_org_select_v2
  ON public.trader_historical_four_surface_ratified_admission_v2;
DROP POLICY IF EXISTS historical_four_surface_ratified_admission_v2_runner_read
  ON public.trader_historical_four_surface_ratified_admission_v2;
REVOKE ALL PRIVILEGES ON TABLE
  public.trader_historical_four_surface_ratified_admission_v2
FROM waia_historical_runner;
GRANT SELECT ON TABLE
  public.trader_historical_four_surface_ratified_admission_v2
TO waia_historical_runner;
CREATE POLICY historical_four_surface_ratified_admission_v2_approved_runner_read
  ON public.trader_historical_four_surface_ratified_admission_v2
  FOR SELECT TO waia_historical_runner
  USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND EXISTS (
      SELECT 1
      FROM public.trader_historical_technical_proposal_v2 proposal
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
       AND approval.organization_id=proposal.organization_id
       AND approval.run_id=proposal.run_id
       AND approval.release_sha=proposal.release_sha
       AND approval.proposal_content_digest_hex=proposal.content_digest_hex
      WHERE proposal.organization_id=
        trader_historical_four_surface_ratified_admission_v2.organization_id
        AND proposal.run_id=
          trader_historical_four_surface_ratified_admission_v2.run_id
        AND proposal.release_sha=
          trader_historical_four_surface_ratified_admission_v2.release_sha
        AND proposal.technical_candidate_json->>'aggregateAdmissionReceiptId'=
          trader_historical_four_surface_ratified_admission_v2
            .aggregate_admission_receipt_id::text
        AND proposal.technical_candidate_json->>'aggregateAdmissionContentDigestHex'=
          trader_historical_four_surface_ratified_admission_v2
            .aggregate_admission_content_digest_hex
    )
  );
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE
  public.trader_historical_ratification_request_v2,
  public.trader_historical_qualified_execution_extent_v2,
  public.trader_historical_technical_proposal_v2,
  public.trader_historical_proposal_ratification_v2
FROM waia_historical_runner;
GRANT SELECT ON TABLE
  public.trader_historical_ratification_request_v2,
  public.trader_historical_proposal_ratification_v2
TO waia_historical_runner;
GRANT SELECT, INSERT ON TABLE public.trader_historical_qualified_execution_extent_v2
TO waia_historical_runner;
GRANT SELECT, INSERT ON TABLE public.trader_historical_technical_proposal_v2
TO waia_historical_runner;
GRANT INSERT ON TABLE public.trader_scientific_admission_receipt_v1
TO waia_historical_runner;
GRANT SELECT ON TABLE public.trader_htx_volume_qualification_receipt_v1
TO waia_historical_runner;
DROP POLICY IF EXISTS historical_htx_volume_qualification_runner_read_v2
  ON public.trader_htx_volume_qualification_receipt_v1;
CREATE POLICY historical_htx_volume_qualification_runner_read_v2
  ON public.trader_htx_volume_qualification_receipt_v1 FOR SELECT TO waia_historical_runner
  USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND verdict='HTX_VOLUME_AUTHORITY_QUALIFIED'
    AND interval='1m'
    AND symbol IN ('BTCUSDT','ETHUSDT')
  );
CREATE POLICY historical_scientific_admission_runner_insert_v2
  ON public.trader_scientific_admission_receipt_v1 FOR INSERT TO waia_historical_runner
  WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND (
      receipt_kind='WF_PREDICTIVE_FOUR_SURFACE' OR EXISTS (
        SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval
        WHERE approval.organization_id=
          trader_scientific_admission_receipt_v1.organization_id
      )
    )
  );
--> statement-breakpoint
-- Canonical MI repositories append an audit event for every Human-semantic row.
-- The runner may append only an event carrying the exact approved run marker and
-- authenticated approving operator. It cannot read, update or delete audit history.
GRANT INSERT ON TABLE public.audit_logs TO waia_historical_runner;
DROP POLICY IF EXISTS historical_ratification_audit_runner_insert_v2
  ON public.audit_logs;
CREATE POLICY historical_ratification_audit_runner_insert_v2
  ON public.audit_logs FOR INSERT TO waia_historical_runner
  WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND actor_type='admin'
    AND EXISTS (
      SELECT 1
      FROM public.trader_historical_proposal_ratification_v2 approval
      JOIN public.trader_historical_technical_proposal_v2 proposal
        ON proposal.id=approval.proposal_id
       AND proposal.organization_id=approval.organization_id
       AND proposal.run_id=approval.run_id
       AND proposal.content_digest_hex=approval.proposal_content_digest_hex
      WHERE approval.organization_id=audit_logs.organization_id
        AND approval.operator_user_id::text=audit_logs.actor_id
        AND audit_logs.action LIKE 'trader.mi\_%' ESCAPE '\'
        AND audit_logs.entity_type LIKE 'trader.mi\_%' ESCAPE '\'
        AND (
          (
            audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND audit_logs.entity_type='trader.mi_measurement'
            AND audit_logs.action IN (
              'trader.mi_measurement.registered','trader.mi_measurement.revised')
            AND EXISTS (
              SELECT 1 FROM public.trader_mi_measurement entity
              WHERE entity.id=audit_logs.entity_id::uuid
                AND entity.organization_id=approval.organization_id
                AND left(entity.name,length(
                  'waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
                ))='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
            )
          ) OR (
            audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND audit_logs.entity_type='trader.mi_pattern'
            AND audit_logs.action IN (
              'trader.mi_pattern.registered','trader.mi_pattern.revised')
            AND EXISTS (
              SELECT 1 FROM public.trader_mi_pattern entity
              WHERE entity.id=audit_logs.entity_id::uuid
                AND entity.organization_id=approval.organization_id
                AND left(entity.name,length(
                  'waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
                ))='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
            )
          ) OR (
            audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND audit_logs.entity_type='trader.mi_pattern_lifecycle'
            AND audit_logs.action IN (
              'trader.mi_pattern.archived','trader.mi_pattern.reactivated')
            AND EXISTS (
              SELECT 1
              FROM public.trader_mi_pattern_lifecycle entity
              JOIN public.trader_mi_pattern parent
                ON parent.id=entity.pattern_id
               AND parent.organization_id=entity.organization_id
              WHERE entity.id=audit_logs.entity_id::uuid
                AND entity.organization_id=approval.organization_id
                AND left(parent.name,length(
                  'waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
                ))='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
            )
          ) OR (
            audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND audit_logs.entity_type='trader.mi_hypothesis'
            AND audit_logs.action IN (
              'trader.mi_hypothesis.registered','trader.mi_hypothesis.revised')
            AND EXISTS (
              SELECT 1 FROM public.trader_mi_hypothesis entity
              WHERE entity.id=audit_logs.entity_id::uuid
                AND entity.organization_id=approval.organization_id
                AND left(entity.name,length(
                  'waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
                ))='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
            )
          ) OR (
            audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND audit_logs.entity_type='trader.mi_hypothesis_lifecycle'
            AND audit_logs.action='trader.mi_hypothesis.lifecycle_transitioned'
            AND EXISTS (
              SELECT 1
              FROM public.trader_mi_hypothesis_lifecycle entity
              JOIN public.trader_mi_hypothesis parent
                ON parent.id=entity.hypothesis_id
               AND parent.organization_id=entity.organization_id
              WHERE entity.id=audit_logs.entity_id::uuid
                AND entity.organization_id=approval.organization_id
                AND left(parent.name,length(
                  'waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
                ))='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
            )
          ) OR (
            audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND audit_logs.entity_type='trader.mi_trial'
            AND audit_logs.action='trader.mi_trial.registered'
            AND EXISTS (
              SELECT 1 FROM public.trader_mi_trial entity
              WHERE entity.id=audit_logs.entity_id::uuid
                AND entity.organization_id=approval.organization_id
                AND entity.research_program=
                  'waia.trader.historical_prerun_knowledge_bootstrap.v2:' || approval.run_id
            )
          ) OR (
            audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND audit_logs.entity_type='trader.mi_evidence'
            AND audit_logs.action='trader.mi_evidence.recorded'
            AND EXISTS (
              SELECT 1
              FROM public.trader_mi_evidence entity
              JOIN public.trader_mi_hypothesis parent
                ON parent.id=entity.hypothesis_id
               AND parent.organization_id=entity.organization_id
              WHERE entity.id=audit_logs.entity_id::uuid
                AND entity.organization_id=approval.organization_id
                AND left(parent.name,length(
                  'waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
                ))='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
                  approval.run_id || ':'
            )
          ) OR (
            audit_logs.action='trader.mi_source.created'
            AND audit_logs.entity_type='trader.mi_source'
            AND audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.trader_mi_source source
              JOIN LATERAL jsonb_array_elements(
                proposal.technical_candidate_json->'surfaces') surface ON true
              WHERE source.id=audit_logs.entity_id::uuid
                AND source.organization_id=approval.organization_id
                AND source.venue='htx' AND source.feed_kind='ohlcv_bar'
                AND source.symbol=surface->>'symbol'
            )
          ) OR (
            audit_logs.action='trader.mi_source_trust.appended'
            AND audit_logs.entity_type='trader.mi_source_trust'
            AND audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.trader_mi_source_trust trust
              JOIN public.trader_mi_source source
                ON source.id=trust.source_id
               AND source.organization_id=trust.organization_id
              JOIN LATERAL jsonb_array_elements(
                proposal.technical_candidate_json->'surfaces') surface ON true
              WHERE trust.id=audit_logs.entity_id::uuid
                AND trust.organization_id=approval.organization_id
                AND trust.recorded_by=
                  'historical-ratification:' || approval.run_id || ':' || approval.release_sha
                AND source.venue='htx' AND source.feed_kind='ohlcv_bar'
                AND source.symbol=surface->>'symbol'
                AND trust.event_time=(surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz
            )
          ) OR (
            audit_logs.action='trader.mi_observation.recorded'
            AND audit_logs.entity_type='trader.mi_observation'
            AND audit_logs.entity_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (
              SELECT 1 FROM public.trader_mi_observation observation
              JOIN public.trader_mi_source source
                ON source.id=observation.source_id
               AND source.organization_id=observation.organization_id
              JOIN LATERAL jsonb_array_elements(
                proposal.technical_candidate_json->'surfaces') surface ON true
              WHERE observation.id=audit_logs.entity_id::uuid
                AND observation.organization_id=approval.organization_id
                AND observation.observed_by=approval.operator_user_id::text
                AND observation.observation_kind='msv_envelope'
                AND source.venue='internal' AND source.feed_kind='msv_envelope'
                AND source.symbol IS NULL
                AND replace(observation.subject_ref,'/','')=surface->>'symbol'
                AND observation.event_time=
                  (surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz
            )
          )
        )
    )
  );
--> statement-breakpoint
-- Exact technical-proposal preparation dependencies.  These grants are still
-- organization-bound and confer no live/capital/credential authority.
DO $do$
DECLARE
  authorized_organization constant uuid :=
    '3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid;
  relation_name text;
  proposal_write_relations constant text[] := ARRAY[
    'trader_mi_source',
    'trader_mi_source_trust',
    'trader_mi_trust_as_of_receipt_v1',
    'trader_mi_measurement',
    'trader_mi_pattern',
    'trader_mi_pattern_lifecycle',
    'trader_mi_hypothesis',
    'trader_mi_hypothesis_lifecycle',
    'trader_mi_trial',
    'trader_mi_evidence',
    'trader_market_predictions',
    'trader_knowledge_edges'
  ];
BEGIN
  FOREACH relation_name IN ARRAY proposal_write_relations LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NULL THEN
      RAISE EXCEPTION 'migration 0201 required relation public.% is absent', relation_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=relation_name
        AND column_name='organization_id'
    ) THEN
      RAISE EXCEPTION 'migration 0201 relation public.% is not organization-scoped', relation_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_proposal_org_select_v2 ON public.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_proposal_org_select_v2 ON public.%I FOR SELECT TO waia_historical_runner USING (organization_id=%L::uuid AND EXISTS (SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval WHERE approval.organization_id=public.%I.organization_id))',
      relation_name, authorized_organization::text, relation_name
    );
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_proposal_org_insert_v2 ON public.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_proposal_org_insert_v2 ON public.%I FOR INSERT TO waia_historical_runner WITH CHECK (organization_id=%L::uuid AND EXISTS (SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval WHERE approval.organization_id=public.%I.organization_id))',
      relation_name, authorized_organization::text, relation_name
    );
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO waia_historical_runner', relation_name);
  END LOOP;

  FOREACH relation_name IN ARRAY ARRAY['trader_market_predictions','trader_knowledge_edges'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_proposal_org_update_v2 ON public.%I', relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_proposal_org_update_v2 ON public.%I FOR UPDATE TO waia_historical_runner USING (organization_id=%L::uuid AND EXISTS (SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval WHERE approval.organization_id=public.%I.organization_id)) WITH CHECK (organization_id=%L::uuid AND EXISTS (SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval WHERE approval.organization_id=public.%I.organization_id))',
      relation_name, authorized_organization::text, relation_name,
      authorized_organization::text, relation_name
    );
  END LOOP;
END
$do$;
REVOKE UPDATE ON TABLE public.trader_market_predictions FROM waia_historical_runner;
GRANT UPDATE (outcome_json,verification_result,verified_at)
  ON public.trader_market_predictions TO waia_historical_runner;
REVOKE UPDATE ON TABLE public.trader_knowledge_edges FROM waia_historical_runner;
GRANT UPDATE (confidence,strength,regime_scope,failure_cases_json,hypothesis_id,verified,updated_at)
  ON public.trader_knowledge_edges TO waia_historical_runner;
--> statement-breakpoint
-- 0199 intentionally established the mechanical runner surface before split
-- ratification existed.  Remove its permissive org-only policies from every
-- Human-semantic/knowledge relation; the approval-gated policies above are the
-- only runner write path after this migration.
DO $do$
DECLARE relation_name text;
  semantic_relations constant text[] := ARRAY[
    'trader_mi_source','trader_mi_source_trust','trader_mi_trust_as_of_receipt_v1',
    'trader_mi_observation','trader_mi_measurement','trader_mi_pattern',
    'trader_mi_pattern_lifecycle','trader_mi_hypothesis','trader_mi_hypothesis_lifecycle',
    'trader_mi_trial','trader_mi_evidence','trader_market_predictions','trader_knowledge_edges'
  ];
BEGIN
  FOREACH relation_name IN ARRAY semantic_relations LOOP
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_select_v2 ON public.%I', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2 ON public.%I', relation_name);
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_update_v2 ON public.%I', relation_name);
  END LOOP;
  DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2
    ON public.trader_scientific_admission_receipt_v1;
END
$do$;
--> statement-breakpoint
-- These two materialization dependencies are not in the proposal-write array.
-- They remain unavailable until an exact authenticated proposal approval exists.
DROP POLICY IF EXISTS waia_historical_proposal_org_select_v2
  ON public.trader_mi_trust_as_of_receipt_v1;
DROP POLICY IF EXISTS waia_historical_proposal_org_insert_v2
  ON public.trader_mi_trust_as_of_receipt_v1;
CREATE POLICY waia_historical_proposal_org_select_v2
  ON public.trader_mi_trust_as_of_receipt_v1 FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval
    WHERE approval.organization_id=trader_mi_trust_as_of_receipt_v1.organization_id));
CREATE POLICY waia_historical_proposal_org_insert_v2
  ON public.trader_mi_trust_as_of_receipt_v1 FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval
    WHERE approval.organization_id=trader_mi_trust_as_of_receipt_v1.organization_id));
CREATE POLICY waia_historical_proposal_org_select_v2
  ON public.trader_mi_observation FOR SELECT TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval
    WHERE approval.organization_id=trader_mi_observation.organization_id));
CREATE POLICY waia_historical_proposal_org_insert_v2
  ON public.trader_mi_observation FOR INSERT TO waia_historical_runner
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_historical_proposal_ratification_v2 approval
    WHERE approval.organization_id=trader_mi_observation.organization_id));
--> statement-breakpoint
-- Replace the temporary organization-wide post-approval policies above with exact
-- run-derived namespaces and parent lineage.  Approval for one run must never open
-- an organization-wide MI/knowledge write surface.
CREATE OR REPLACE FUNCTION public.waia_historical_approved_knowledge_namespace_v2(
  requested_organization uuid, requested_value text
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.trader_historical_proposal_ratification_v2 approval
    JOIN public.trader_historical_technical_proposal_v2 proposal
      ON proposal.id=approval.proposal_id
     AND proposal.organization_id=approval.organization_id
     AND proposal.run_id=approval.run_id
     AND proposal.content_digest_hex=approval.proposal_content_digest_hex
    WHERE proposal.organization_id=requested_organization
      AND requested_organization='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
      AND (
        -- Trial research-program identity, including its caller-added separator.
        requested_value='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
          proposal.run_id || ':'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(proposal.technical_candidate_json->'surfaces') surface,
            unnest(ARRAY['msv','trend_continuation','reversal','accumulation',
              'distribution','breakout','false_breakout','liquidity_sweep',
              'mean_reversion']) AS suffix(value)
          WHERE requested_value='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
              proposal.run_id || ':' || (surface->>'surfaceKey') || ':' || suffix.value
            OR (suffix.value <> 'msv' AND requested_value=
              'waia.trader.historical_prerun_knowledge_bootstrap.v2:' || proposal.run_id ||
              ':' || (surface->>'surfaceKey') || ':' || suffix.value || ':pattern')
        )
      )
  )
$fn$;
REVOKE ALL ON FUNCTION public.waia_historical_approved_knowledge_namespace_v2(uuid,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waia_historical_approved_knowledge_namespace_v2(uuid,text)
  TO waia_historical_runner;
--> statement-breakpoint
DO $do$
DECLARE relation_name text;
  semantic_relations constant text[] := ARRAY[
    'trader_mi_source','trader_mi_source_trust','trader_mi_trust_as_of_receipt_v1',
    'trader_mi_observation','trader_mi_measurement','trader_mi_pattern',
    'trader_mi_pattern_lifecycle','trader_mi_hypothesis','trader_mi_hypothesis_lifecycle',
    'trader_mi_trial','trader_mi_evidence','trader_market_predictions','trader_knowledge_edges'
  ];
BEGIN
  FOREACH relation_name IN ARRAY semantic_relations LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS waia_historical_proposal_org_select_v2 ON public.%I',
      relation_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS waia_historical_proposal_org_insert_v2 ON public.%I',
      relation_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS waia_historical_proposal_org_update_v2 ON public.%I',
      relation_name);
  END LOOP;
END
$do$;
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_source
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND (
      (venue='internal' AND feed_kind='msv_envelope' AND symbol IS NULL) OR EXISTS (
        SELECT 1
        FROM public.trader_historical_technical_proposal_v2 proposal
        JOIN public.trader_historical_proposal_ratification_v2 approval
          ON approval.proposal_id=proposal.id
         AND approval.organization_id=proposal.organization_id
         AND approval.run_id=proposal.run_id
         AND approval.proposal_content_digest_hex=proposal.content_digest_hex
        JOIN LATERAL jsonb_array_elements(
          proposal.technical_candidate_json->'surfaces') surface ON true
        WHERE proposal.organization_id=trader_mi_source.organization_id
          AND venue='htx' AND feed_kind='ohlcv_bar' AND symbol=surface->>'symbol'
      )
    ));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_source
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND status='active' AND (
      (venue='internal' AND feed_kind='msv_envelope' AND symbol IS NULL) OR EXISTS (
        SELECT 1
        FROM public.trader_historical_technical_proposal_v2 proposal
        JOIN public.trader_historical_proposal_ratification_v2 approval
          ON approval.proposal_id=proposal.id
         AND approval.organization_id=proposal.organization_id
         AND approval.run_id=proposal.run_id
         AND approval.proposal_content_digest_hex=proposal.content_digest_hex
        JOIN LATERAL jsonb_array_elements(
          proposal.technical_candidate_json->'surfaces') surface ON true
        WHERE proposal.organization_id=trader_mi_source.organization_id
          AND venue='htx' AND feed_kind='ohlcv_bar' AND symbol=surface->>'symbol'
      )
    ));
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_source_trust
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
      SELECT 1 FROM public.trader_mi_source source
      JOIN public.trader_historical_technical_proposal_v2 proposal
        ON proposal.organization_id=source.organization_id
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
       AND approval.organization_id=proposal.organization_id
       AND approval.run_id=proposal.run_id
       AND approval.proposal_content_digest_hex=proposal.content_digest_hex
      JOIN LATERAL jsonb_array_elements(
        proposal.technical_candidate_json->'surfaces') surface ON true
      WHERE source.id=trader_mi_source_trust.source_id
        AND source.organization_id=trader_mi_source_trust.organization_id
        AND source.venue='htx' AND source.feed_kind='ohlcv_bar'
        AND source.symbol=surface->>'symbol'
        AND recorded_by='historical-ratification:' || approval.run_id || ':' || approval.release_sha
        AND event_time=(surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz
    ));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_source_trust
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
      SELECT 1 FROM public.trader_mi_source source
      JOIN public.trader_historical_technical_proposal_v2 proposal
        ON proposal.organization_id=source.organization_id
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
       AND approval.organization_id=proposal.organization_id
       AND approval.run_id=proposal.run_id
       AND approval.proposal_content_digest_hex=proposal.content_digest_hex
      JOIN LATERAL jsonb_array_elements(
        proposal.technical_candidate_json->'surfaces') surface ON true
      WHERE source.id=trader_mi_source_trust.source_id
        AND source.organization_id=trader_mi_source_trust.organization_id
        AND source.venue='htx' AND source.feed_kind='ohlcv_bar'
        AND source.symbol=surface->>'symbol'
        AND recorded_by='historical-ratification:' || approval.run_id || ':' || approval.release_sha
        AND event_time=(surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz
    ));
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2
  ON public.trader_mi_trust_as_of_receipt_v1 FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
      SELECT 1 FROM public.trader_mi_source_trust trust
      WHERE trust.id=trader_mi_trust_as_of_receipt_v1.selected_trust_revision_id
        AND trust.organization_id=trader_mi_trust_as_of_receipt_v1.organization_id
        AND trust.source_id=trader_mi_trust_as_of_receipt_v1.source_id
    ));
CREATE POLICY waia_historical_proposal_exact_insert_v2
  ON public.trader_mi_trust_as_of_receipt_v1 FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND status='RESOLVED' AND EXISTS (
      SELECT 1 FROM public.trader_mi_source_trust trust
      WHERE trust.id=trader_mi_trust_as_of_receipt_v1.selected_trust_revision_id
        AND trust.organization_id=trader_mi_trust_as_of_receipt_v1.organization_id
        AND trust.source_id=trader_mi_trust_as_of_receipt_v1.source_id
    ));
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_observation
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
      SELECT 1 FROM public.trader_mi_source source
      JOIN public.trader_historical_technical_proposal_v2 proposal
        ON proposal.organization_id=source.organization_id
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
       AND approval.organization_id=proposal.organization_id
       AND approval.run_id=proposal.run_id
       AND approval.proposal_content_digest_hex=proposal.content_digest_hex
      JOIN LATERAL jsonb_array_elements(
        proposal.technical_candidate_json->'surfaces') surface ON true
      WHERE source.id=trader_mi_observation.source_id
        AND source.organization_id=trader_mi_observation.organization_id
        AND replace(subject_ref,'/','')=surface->>'symbol'
        AND (
          (source.venue='internal' AND source.feed_kind='msv_envelope' AND source.symbol IS NULL
            AND observation_kind='msv_envelope'
            AND observed_by=approval.operator_user_id::text
            AND event_time=(surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz)
          OR
          (source.venue='htx' AND source.feed_kind='ohlcv_bar'
            AND source.symbol=surface->>'symbol'
            AND observation_kind::text='ohlcv_bar'
            AND observed_by='canonical-gateway-pit-v1'
            AND source_trust_revision_id IS NOT NULL
            AND trust_as_of_receipt_id IS NOT NULL
            AND (
              event_time=(surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz
              OR EXISTS (
                SELECT 1 FROM public.trader_historical_dataset_authority_v2 dataset
                WHERE dataset.organization_id=proposal.organization_id
                  AND dataset.run_id=proposal.run_id
                  AND dataset.dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
                  AND dataset.dataset_authority_digest_hex=
                    proposal.technical_candidate_json->>'qualificationReceiptDigestHex'
                  AND dataset.membership_json->>'partition'='WALK_FORWARD'
                  AND dataset.membership_json->>'symbol'=surface->>'symbol'
                  AND (dataset.membership_json->>'recordIndex')::integer >=
                    (proposal.launch_plan_json->>'initialRecordIndex')::integer
                  AND (dataset.membership_json->>'recordIndex')::integer <
                    (proposal.launch_plan_json->>'initialRecordIndex')::integer +
                    (proposal.launch_plan_json->>'cycleCount')::integer
                  AND (dataset.sealed_cycle_json->'closedBar'->>'barCloseTime')::timestamptz=
                    event_time
              )
            ))
        )
    ));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_observation
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
      SELECT 1 FROM public.trader_mi_source source
      JOIN public.trader_historical_technical_proposal_v2 proposal
        ON proposal.organization_id=source.organization_id
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
       AND approval.organization_id=proposal.organization_id
       AND approval.run_id=proposal.run_id
       AND approval.proposal_content_digest_hex=proposal.content_digest_hex
      JOIN LATERAL jsonb_array_elements(
        proposal.technical_candidate_json->'surfaces') surface ON true
      WHERE source.id=trader_mi_observation.source_id
        AND source.organization_id=trader_mi_observation.organization_id
        AND replace(subject_ref,'/','')=surface->>'symbol'
        AND (
          (source.venue='internal' AND source.feed_kind='msv_envelope' AND source.symbol IS NULL
            AND observation_kind='msv_envelope'
            AND observed_by=approval.operator_user_id::text
            AND event_time=(surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz)
          OR
          (source.venue='htx' AND source.feed_kind='ohlcv_bar'
            AND source.symbol=surface->>'symbol'
            AND observation_kind::text='ohlcv_bar'
            AND observed_by='canonical-gateway-pit-v1'
            AND source_trust_revision_id IS NOT NULL
            AND trust_as_of_receipt_id IS NOT NULL
            AND (
              event_time=(surface->'marketBoundaryBar'->>'barCloseTime')::timestamptz
              OR EXISTS (
                SELECT 1 FROM public.trader_historical_dataset_authority_v2 dataset
                WHERE dataset.organization_id=proposal.organization_id
                  AND dataset.run_id=proposal.run_id
                  AND dataset.dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
                  AND dataset.dataset_authority_digest_hex=
                    proposal.technical_candidate_json->>'qualificationReceiptDigestHex'
                  AND dataset.membership_json->>'partition'='WALK_FORWARD'
                  AND dataset.membership_json->>'symbol'=surface->>'symbol'
                  AND (dataset.membership_json->>'recordIndex')::integer >=
                    (proposal.launch_plan_json->>'initialRecordIndex')::integer
                  AND (dataset.membership_json->>'recordIndex')::integer <
                    (proposal.launch_plan_json->>'initialRecordIndex')::integer +
                    (proposal.launch_plan_json->>'cycleCount')::integer
                  AND (dataset.sealed_cycle_json->'closedBar'->>'barCloseTime')::timestamptz=
                    event_time
              )
            ))
        )
    ));
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_measurement
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(organization_id,name));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_measurement
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(organization_id,name));
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_pattern
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(organization_id,name));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_pattern
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(organization_id,name));
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_hypothesis
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(organization_id,name));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_hypothesis
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(organization_id,name));
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_pattern_lifecycle
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_pattern parent
    WHERE parent.id=trader_mi_pattern_lifecycle.pattern_id
      AND parent.organization_id=trader_mi_pattern_lifecycle.organization_id));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_pattern_lifecycle
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_pattern parent
    WHERE parent.id=trader_mi_pattern_lifecycle.pattern_id
      AND parent.organization_id=trader_mi_pattern_lifecycle.organization_id));
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_hypothesis_lifecycle
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_mi_hypothesis_lifecycle.hypothesis_id
      AND parent.organization_id=trader_mi_hypothesis_lifecycle.organization_id));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_hypothesis_lifecycle
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_mi_hypothesis_lifecycle.hypothesis_id
      AND parent.organization_id=trader_mi_hypothesis_lifecycle.organization_id));
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_trial
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(
      organization_id,research_program || ':'));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_trial
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND
    public.waia_historical_approved_knowledge_namespace_v2(
      organization_id,research_program || ':'));
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_mi_evidence
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_mi_evidence.hypothesis_id
      AND parent.organization_id=trader_mi_evidence.organization_id));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_mi_evidence
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_mi_evidence.hypothesis_id
      AND parent.organization_id=trader_mi_evidence.organization_id));
--> statement-breakpoint
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_market_predictions
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE subject_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_market_predictions.organization_id));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_market_predictions
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE subject_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_market_predictions.organization_id));
CREATE POLICY waia_historical_proposal_exact_update_v2 ON public.trader_market_predictions
  FOR UPDATE TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE subject_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_market_predictions.organization_id))
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE subject_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_market_predictions.organization_id));
CREATE POLICY waia_historical_proposal_exact_select_v2 ON public.trader_knowledge_edges
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_knowledge_edges.hypothesis_id
      AND to_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_knowledge_edges.organization_id));
CREATE POLICY waia_historical_proposal_exact_insert_v2 ON public.trader_knowledge_edges
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (
    SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_knowledge_edges.hypothesis_id
      AND to_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_knowledge_edges.organization_id));
CREATE POLICY waia_historical_proposal_exact_update_v2 ON public.trader_knowledge_edges
  FOR UPDATE TO waia_historical_runner
  USING (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_knowledge_edges.hypothesis_id
      AND to_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_knowledge_edges.organization_id))
  WITH CHECK (organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid AND EXISTS (SELECT 1 FROM public.trader_mi_hypothesis parent
    WHERE parent.id=trader_knowledge_edges.hypothesis_id
      AND to_ref='hypothesis:' || parent.id::text
      AND parent.organization_id=trader_knowledge_edges.organization_id));
-- Forecast V2 cold-start is an explicitly neutral, unverified package claim.  It has
-- no hypothesis yet, so it cannot use the hypothesis-bound policies above.  Permit
-- only the exact package/symbol/horizon tuple present in both the Human-approved
-- technical proposal and its immutable finalized authority.  This deliberately
-- provides no UPDATE path: a later learned claim must be written through the
-- hypothesis-bound knowledge lifecycle instead of mutating the neutral seed.
DROP POLICY IF EXISTS waia_historical_approved_neutral_package_select_v2
  ON public.trader_knowledge_edges;
CREATE POLICY waia_historical_approved_neutral_package_select_v2
  ON public.trader_knowledge_edges FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND hypothesis_id IS NULL
    AND relation_kind='predictive_package_models_symbol_horizon'
    AND confidence='0.50000000' AND strength='0.00000000'
    AND regime_scope='ALL' AND failure_cases_json='[]' AND verified=false
    AND EXISTS (
      SELECT 1
      FROM public.trader_historical_technical_proposal_v2 proposal
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
       AND approval.organization_id=proposal.organization_id
       AND approval.run_id=proposal.run_id
       AND approval.release_sha=proposal.release_sha
       AND approval.proposal_content_digest_hex=proposal.content_digest_hex
      JOIN public.trader_historical_four_surface_ratified_admission_v2 authority
        ON authority.organization_id=proposal.organization_id
       AND authority.run_id=proposal.run_id
       AND authority.release_sha=proposal.release_sha
      JOIN LATERAL jsonb_array_elements(
        proposal.technical_candidate_json->'surfaces') candidate(surface) ON true
      JOIN LATERAL jsonb_array_elements(
        authority.authority_json->'surfaceAdmissions') admitted(surface) ON
          admitted.surface->>'surfaceKey'=candidate.surface->>'surfaceKey'
      WHERE proposal.organization_id=trader_knowledge_edges.organization_id
        AND trader_knowledge_edges.from_ref='predictive-package:' ||
          (admitted.surface->>'predictivePackageContentDigestHex')
        AND trader_knowledge_edges.to_ref='market-horizon:' ||
          (candidate.surface->>'symbol') || ':' ||
          (candidate.surface->>'executionHorizonMinutes') || 'm'
    ));
DROP POLICY IF EXISTS waia_historical_approved_neutral_package_insert_v2
  ON public.trader_knowledge_edges;
CREATE POLICY waia_historical_approved_neutral_package_insert_v2
  ON public.trader_knowledge_edges FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND hypothesis_id IS NULL
    AND relation_kind='predictive_package_models_symbol_horizon'
    AND confidence='0.50000000' AND strength='0.00000000'
    AND regime_scope='ALL' AND failure_cases_json='[]' AND verified=false
    AND EXISTS (
      SELECT 1
      FROM public.trader_historical_technical_proposal_v2 proposal
      JOIN public.trader_historical_proposal_ratification_v2 approval
        ON approval.proposal_id=proposal.id
       AND approval.organization_id=proposal.organization_id
       AND approval.run_id=proposal.run_id
       AND approval.release_sha=proposal.release_sha
       AND approval.proposal_content_digest_hex=proposal.content_digest_hex
      JOIN public.trader_historical_four_surface_ratified_admission_v2 authority
        ON authority.organization_id=proposal.organization_id
       AND authority.run_id=proposal.run_id
       AND authority.release_sha=proposal.release_sha
      JOIN LATERAL jsonb_array_elements(
        proposal.technical_candidate_json->'surfaces') candidate(surface) ON true
      JOIN LATERAL jsonb_array_elements(
        authority.authority_json->'surfaceAdmissions') admitted(surface) ON
          admitted.surface->>'surfaceKey'=candidate.surface->>'surfaceKey'
      WHERE proposal.organization_id=trader_knowledge_edges.organization_id
        AND trader_knowledge_edges.from_ref='predictive-package:' ||
          (admitted.surface->>'predictivePackageContentDigestHex')
        AND trader_knowledge_edges.to_ref='market-horizon:' ||
          (candidate.surface->>'symbol') || ':' ||
          (candidate.surface->>'executionHorizonMinutes') || 'm'
    ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_historical_approved_run_account_v2(
  requested_organization uuid, requested_run text, requested_account text
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.trader_historical_technical_proposal_v2 proposal
    JOIN public.trader_historical_proposal_ratification_v2 approval
      ON approval.proposal_id=proposal.id
     AND approval.organization_id=proposal.organization_id
     AND approval.run_id=proposal.run_id
     AND approval.proposal_content_digest_hex=proposal.content_digest_hex
    JOIN public.trader_historical_four_surface_ratified_admission_v2 authority
      ON authority.organization_id=proposal.organization_id
     AND authority.run_id=proposal.run_id
     AND authority.release_sha=proposal.release_sha
    WHERE proposal.organization_id=requested_organization
      AND proposal.run_id=requested_run
      AND proposal.launch_plan_json->>'accountId'=requested_account
  )
$fn$;
REVOKE ALL ON FUNCTION public.waia_historical_approved_run_account_v2(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waia_historical_approved_run_account_v2(uuid,text,text)
  TO waia_historical_runner;
--> statement-breakpoint
-- Replace org-wide 0199 modeled execution/accounting access with exact approved
-- historical run/account lineage.  Child facts inherit scope through their parent mock order.
DROP POLICY IF EXISTS waia_historical_runner_org_select_v2 ON public.trader_orders;
DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2 ON public.trader_orders;
DROP POLICY IF EXISTS waia_historical_runner_org_update_v2 ON public.trader_orders;
REVOKE UPDATE ON TABLE public.trader_orders FROM waia_historical_runner;
GRANT UPDATE (state,state_version,filled_quantity,avg_fill_price,exchange_order_id,updated_at)
  ON public.trader_orders TO waia_historical_runner;
CREATE POLICY waia_historical_runner_exact_select_v2 ON public.trader_orders
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND execution_mode='mock'::public.order_execution_mode
    AND historical_run_id IS NOT NULL AND historical_account_key IS NOT NULL
    AND public.waia_historical_approved_run_account_v2(
      organization_id,historical_run_id,historical_account_key));
CREATE POLICY waia_historical_runner_exact_insert_v2 ON public.trader_orders
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND execution_mode='mock'::public.order_execution_mode AND credential_id IS NULL
    AND historical_run_id IS NOT NULL AND historical_account_key IS NOT NULL
    AND public.waia_historical_approved_run_account_v2(
      organization_id,historical_run_id,historical_account_key));
CREATE POLICY waia_historical_runner_exact_update_v2 ON public.trader_orders
  FOR UPDATE TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND execution_mode='mock'::public.order_execution_mode
    AND public.waia_historical_approved_run_account_v2(
      organization_id,historical_run_id,historical_account_key))
  WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND execution_mode='mock'::public.order_execution_mode AND credential_id IS NULL
    AND public.waia_historical_approved_run_account_v2(
      organization_id,historical_run_id,historical_account_key));
--> statement-breakpoint
DO $do$
DECLARE relation_name text;
  child_relations constant text[] := ARRAY[
    'trader_order_events','trader_fills','trader_fill_execution_economics'
  ];
BEGIN
  FOREACH relation_name IN ARRAY child_relations LOOP
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_select_v2 ON public.%I',relation_name);
    EXECUTE format('DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2 ON public.%I',relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_runner_exact_select_v2 ON public.%I FOR SELECT TO waia_historical_runner USING (organization_id=%L::uuid AND EXISTS (SELECT 1 FROM public.trader_orders parent WHERE parent.id=public.%I.order_id AND parent.organization_id=public.%I.organization_id AND parent.execution_mode=''mock''::public.order_execution_mode AND public.waia_historical_approved_run_account_v2(parent.organization_id,parent.historical_run_id,parent.historical_account_key)))',
      relation_name,'3c50b4e9-1138-43a5-a29f-e65088124cfc',relation_name,relation_name);
    EXECUTE format(
      'CREATE POLICY waia_historical_runner_exact_insert_v2 ON public.%I FOR INSERT TO waia_historical_runner WITH CHECK (organization_id=%L::uuid AND EXISTS (SELECT 1 FROM public.trader_orders parent WHERE parent.id=public.%I.order_id AND parent.organization_id=public.%I.organization_id AND parent.execution_mode=''mock''::public.order_execution_mode AND public.waia_historical_approved_run_account_v2(parent.organization_id,parent.historical_run_id,parent.historical_account_key)))',
      relation_name,'3c50b4e9-1138-43a5-a29f-e65088124cfc',relation_name,relation_name);
  END LOOP;
END
$do$;
DROP POLICY IF EXISTS waia_historical_runner_org_select_v2 ON public.trader_accounting_frontier;
DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2 ON public.trader_accounting_frontier;
CREATE POLICY waia_historical_runner_exact_select_v2 ON public.trader_accounting_frontier
  FOR SELECT TO waia_historical_runner USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND public.waia_historical_approved_run_account_v2(organization_id,run_id,account_key));
CREATE POLICY waia_historical_runner_exact_insert_v2 ON public.trader_accounting_frontier
  FOR INSERT TO waia_historical_runner WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND public.waia_historical_approved_run_account_v2(organization_id,run_id,account_key));
--> statement-breakpoint
-- Narrow post-approval materializer.  The runner cannot INSERT the final Human authority
-- directly: this verifier requires the exact Admin-approved proposal and candidate digests.
CREATE OR REPLACE FUNCTION public.waia_historical_finalizer_guard_v2(
  p_failed boolean,
  p_code text
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $guard$
BEGIN
  IF COALESCE(p_failed,true) THEN
    RAISE EXCEPTION 'historical final authority binding failed: %', p_code
      USING ERRCODE='check_violation';
  END IF;
  RETURN false;
END
$guard$;
REVOKE ALL ON FUNCTION public.waia_historical_finalizer_guard_v2(boolean,text)
  FROM PUBLIC;
--> statement-breakpoint
-- The v1 receipt predates semantic-JSON canonicalization: its digest is the SHA-256
-- of JSON.stringify(body), whose property insertion order is part of the durable
-- contract.  Reconstruct that exact byte sequence instead of sorting jsonb keys.
CREATE OR REPLACE FUNCTION public.waia_epistemic_parameter_ratification_v1_content_digest_hex(
  p_receipt jsonb
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $digest$
DECLARE
  serialized text;
BEGIN
  IF jsonb_typeof(p_receipt) <> 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(p_receipt)) <> 10
    OR p_receipt->>'schemaVersion' <> 'epistemic-parameter-ratification/v1'
    OR p_receipt->>'verdict' <> 'RATIFIED'
    OR jsonb_typeof(p_receipt->'selectedK') <> 'number'
    OR jsonb_typeof(p_receipt->'selectedM') <> 'number'
    OR (p_receipt->>'selectedK')::integer <= 0
    OR (p_receipt->>'selectedM')::integer <= 0
    OR p_receipt->>'alphaEpiConfigScale8' !~ '^[0-9]+\.[0-9]{8}$'
  THEN
    RETURN NULL;
  END IF;
  serialized :=
    '{"schemaVersion":' || to_jsonb(p_receipt->>'schemaVersion')::text ||
    ',"verdict":' || to_jsonb(p_receipt->>'verdict')::text ||
    ',"kmConvergenceEvidenceSemanticDigestHex":' ||
      to_jsonb(p_receipt->>'kmConvergenceEvidenceSemanticDigestHex')::text ||
    ',"selectedK":' || (p_receipt->>'selectedK')::integer::text ||
    ',"selectedM":' || (p_receipt->>'selectedM')::integer::text ||
    ',"alphaEpiConfigScale8":' ||
      to_jsonb(p_receipt->>'alphaEpiConfigScale8')::text ||
    ',"selectedPackageGenerationIdentityDigestHex":' ||
      to_jsonb(p_receipt->>'selectedPackageGenerationIdentityDigestHex')::text ||
    ',"selectedPackageContentDigestHex":' ||
      to_jsonb(p_receipt->>'selectedPackageContentDigestHex')::text ||
    ',"humanReceiptIdentityDigestHex":' ||
      to_jsonb(p_receipt->>'humanReceiptIdentityDigestHex')::text || '}';
  RETURN encode(sha256(convert_to(serialized,'UTF8')),'hex');
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
END
$digest$;
REVOKE ALL ON FUNCTION
  public.waia_epistemic_parameter_ratification_v1_content_digest_hex(jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.waia_epistemic_parameter_ratification_v1_content_digest_hex(jsonb)
  TO waia_historical_runner;
--> statement-breakpoint
-- Replace the temporary organization-wide scientific INSERT gate with exact
-- request/proposal/approval/surface lineage. The aggregate receipt is technical
-- pre-proposal evidence, so it is allowed only for a sealed operator request.
-- WF_PREDICTIVE contains Human-semantic evidence and is allowed only after the
-- exact candidate surface has a durable Admin approval.
DROP POLICY IF EXISTS historical_scientific_admission_runner_insert_v2
  ON public.trader_scientific_admission_receipt_v1;
CREATE POLICY historical_scientific_admission_runner_insert_v2
  ON public.trader_scientific_admission_receipt_v1
  FOR INSERT TO waia_historical_runner
  WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND (
      (
        receipt_kind='WF_PREDICTIVE_FOUR_SURFACE'
        AND schema_version='scientific-admission-four-surface/v2'
        AND selected_k_config_dec IS NULL AND selected_m_config_dec IS NULL
        AND selected_package_generation_identity_digest IS NULL
        AND selected_package_content_digest IS NULL
        AND receipt_json::jsonb->>'schemaVersion'=schema_version
        AND receipt_json::jsonb->>'receiptKind'=receipt_kind
        AND receipt_json::jsonb->>'terminalStatus'='SCIENTIFICALLY_ADMITTED'
        AND receipt_json::jsonb->>'organizationId'=organization_id::text
        AND receipt_json::jsonb->>'kmGlobalAnchorSetDigestHex'=km_global_anchor_set_digest
        AND receipt_json::jsonb->>'aggregateFamilySetDigestHex'=
          replica_root_family_identity_digest
        AND receipt_json::jsonb->>'alphaEpiConfigScale8'=alpha_epi_config_scale8
        AND receipt_json::jsonb->>'evidenceSemanticDigestHex'=evidence_semantic_digest
        AND receipt_json::jsonb->>'contentDigestHex'=content_digest
        AND receipt_json::jsonb->'authorityBoundary'=jsonb_build_object(
          'capitalAuthority','NONE','liveTradingAuthority','NONE',
          'blindHoldoutAuthority','FORBIDDEN_NOT_PRESENT_NOT_ACCESSED',
          'humanRatificationAuthority','NOT_CLAIMED_BY_THIS_RECEIPT')
        AND EXISTS (
          SELECT 1
          FROM public.trader_historical_ratification_request_v2 request
          WHERE request.organization_id=
              trader_scientific_admission_receipt_v1.organization_id
            AND request.run_id=receipt_json::jsonb->>'runId'
            AND request.release_sha=receipt_json::jsonb->>'releaseSha'
            AND request.request_json::jsonb->>'contentDigestHex'=request.content_digest_hex
            AND request.request_json::jsonb->>'schemaVersion'=
              'waia.trader.historical_ratification_request.v2'
            AND request.request_json::jsonb->>'organizationId'=request.organization_id::text
            AND request.request_json::jsonb->>'runId'=request.run_id
            AND request.request_json::jsonb->>'releaseSha'=request.release_sha
            AND request.request_json::jsonb->>'humanDecision'=
              'REQUEST_EXACT_PRE_HOLDOUT_TECHNICAL_PROPOSAL'
            AND request.request_json::jsonb->'authorityBoundary'=jsonb_build_object(
              'capitalAuthority','NONE','liveTradingAuthority','NONE',
              'blindHoldoutAuthority','FORBIDDEN_NOT_PRESENT_NOT_ACCESSED')
        )
      )
      OR
      (
        receipt_kind='WF_PREDICTIVE'
        AND schema_version='scientific-admission-receipt/v2'
        AND selected_k_config_dec IS NOT NULL AND selected_m_config_dec IS NOT NULL
        AND selected_package_generation_identity_digest IS NOT NULL
        AND selected_package_content_digest IS NOT NULL
        AND receipt_json::jsonb->>'schemaVersion'=schema_version
        AND receipt_json::jsonb->>'organizationId'=organization_id::text
        AND receipt_json::jsonb->>'wfPartition'='WF_PREDICTIVE'
        AND receipt_json::jsonb->>'terminalStatus'='ADMITTED'
        AND receipt_json::jsonb->>'evidenceSemanticDigestHex'=evidence_semantic_digest
        AND receipt_json::jsonb->>'contentDigestHex'=content_digest
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,kmGlobalAnchorSetDigestHex}'=
          km_global_anchor_set_digest
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,replicaRootFamilyIdentityDigestHex}'=
          replica_root_family_identity_digest
        AND (receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedK}')::integer=
          selected_k_config_dec
        AND (receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedM}')::integer=
          selected_m_config_dec
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,alphaEpiConfigScale8}'=
          alpha_epi_config_scale8
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedPackageGenerationIdentityDigestHex}'=
          selected_package_generation_identity_digest
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedPackageContentDigestHex}'=
          selected_package_content_digest
        AND receipt_json::jsonb#>>'{epistemicParameterRatificationReceipt,contentDigestHex}'=
          public.waia_epistemic_parameter_ratification_v1_content_digest_hex(
            receipt_json::jsonb->'epistemicParameterRatificationReceipt')
        AND EXISTS (
          SELECT 1
          FROM public.trader_historical_technical_proposal_v2 proposal
          JOIN public.trader_historical_proposal_ratification_v2 approval
            ON approval.proposal_id=proposal.id
           AND approval.organization_id=proposal.organization_id
           AND approval.run_id=proposal.run_id
           AND approval.release_sha=proposal.release_sha
           AND approval.proposal_content_digest_hex=proposal.content_digest_hex
          JOIN public.trader_scientific_admission_receipt_v1 aggregate
            ON aggregate.id=(proposal.technical_candidate_json->>
              'aggregateAdmissionReceiptId')::uuid
           AND aggregate.organization_id=proposal.organization_id
           AND aggregate.receipt_kind='WF_PREDICTIVE_FOUR_SURFACE'
           AND aggregate.content_digest=proposal.technical_candidate_json->>
              'aggregateAdmissionContentDigestHex'
          JOIN LATERAL jsonb_array_elements(
            proposal.technical_candidate_json->'surfaces') candidate(surface) ON true
          JOIN LATERAL jsonb_array_elements(
            aggregate.receipt_json::jsonb#>'{sourceAuthority,contract,surfaces}'
          ) frozen(surface) ON frozen.surface->>'surfaceKey'=
              candidate.surface->>'surfaceKey'
          WHERE proposal.organization_id=
              trader_scientific_admission_receipt_v1.organization_id
            AND candidate.surface->>'familyIdentityDigestHex'=
              trader_scientific_admission_receipt_v1.replica_root_family_identity_digest
            AND candidate.surface->>'kmGlobalAnchorSetDigestHex'=
              trader_scientific_admission_receipt_v1.km_global_anchor_set_digest
            AND candidate.surface->>'predictivePackageGenerationIdentityDigestHex'=
              trader_scientific_admission_receipt_v1
                .selected_package_generation_identity_digest
            AND candidate.surface->>'predictivePackageContentDigestHex'=
              trader_scientific_admission_receipt_v1.selected_package_content_digest
            AND candidate.surface->'predictiveTerminalReceipt'=
              trader_scientific_admission_receipt_v1.receipt_json::jsonb->
                'predictiveTerminalReceipt'
            AND frozen.surface->'convergenceReceipt'=
              trader_scientific_admission_receipt_v1.receipt_json::jsonb->
                'kmConvergenceReceipt'
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,verdict}'=
              'RATIFIED'
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedK}'=
              trader_scientific_admission_receipt_v1.selected_k_config_dec::text
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedM}'=
              trader_scientific_admission_receipt_v1.selected_m_config_dec::text
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,alphaEpiConfigScale8}'=
              trader_scientific_admission_receipt_v1.alpha_epi_config_scale8
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedPackageGenerationIdentityDigestHex}'=
              trader_scientific_admission_receipt_v1
                .selected_package_generation_identity_digest
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedPackageContentDigestHex}'=
              trader_scientific_admission_receipt_v1.selected_package_content_digest
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,humanReceiptIdentityDigestHex}'=
              encode(sha256(convert_to(public.waia_canonical_jsonb_v1(jsonb_build_object(
                'schemaVersion','waia.trader.historical_human_ratification_identity.v2',
                'intent','HUMAN_RATIFY_PREDICTIVE_SURFACE_FOR_HISTORICAL_SIMULATION',
                'organizationId',proposal.organization_id::text,
                'runId',proposal.run_id,'releaseSha',proposal.release_sha,
                'operatorUserId',approval.operator_user_id::text,
                'aggregateAdmissionReceiptId',
                  proposal.technical_candidate_json->>'aggregateAdmissionReceiptId',
                'aggregateAdmissionContentDigestHex',
                  proposal.technical_candidate_json->>'aggregateAdmissionContentDigestHex',
                'surfaceKey',candidate.surface->>'surfaceKey',
                'familyIdentityDigestHex',candidate.surface->>'familyIdentityDigestHex',
                'predictiveTerminalReceiptContentDigestHex',
                  candidate.surface#>>'{predictiveTerminalReceipt,contentDigestHex}',
                'kmConvergenceEvidenceSemanticDigestHex',
                  frozen.surface#>>'{convergenceReceipt,evidenceSemanticDigestHex}',
                'selectedK',(frozen.surface#>>'{convergenceReceipt,selectedK}')::integer,
                'selectedM',(frozen.surface#>>'{convergenceReceipt,selectedM}')::integer,
                'predictivePackageGenerationIdentityDigestHex',
                  candidate.surface->>'predictivePackageGenerationIdentityDigestHex',
                'predictivePackageContentDigestHex',
                  candidate.surface->>'predictivePackageContentDigestHex'
              )),'UTF8')),'hex')
        )
      )
    )
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_finalize_historical_four_surface_authority_v2(
  p_proposal_id uuid,
  p_proposal_content_digest_hex text,
  p_technical_candidate_content_digest_hex text,
  p_authority jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  proposal_row public.trader_historical_technical_proposal_v2%ROWTYPE;
  approval_row public.trader_historical_proposal_ratification_v2%ROWTYPE;
  existing_id uuid;
  inserted_id uuid := gen_random_uuid();
  scientific_row_identity_ok boolean;
  scientific_receipt_digests_ok boolean;
  scientific_predictive_terminal_ok boolean;
  scientific_convergence_receipt_ok boolean;
  scientific_human_convergence_digest_ok boolean;
  scientific_human_selected_km_ok boolean;
  scientific_human_alpha_ok boolean;
  scientific_global_anchor_ok boolean;
  scientific_family_identity_ok boolean;
  scientific_selected_package_ok boolean;
  scientific_human_identity_ok boolean;
  scientific_human_content_digest_ok boolean;
BEGIN
  SELECT * INTO STRICT proposal_row
  FROM public.trader_historical_technical_proposal_v2
  WHERE id=p_proposal_id AND content_digest_hex=p_proposal_content_digest_hex
    AND organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND technical_candidate_content_digest_hex=p_technical_candidate_content_digest_hex;
  SELECT * INTO STRICT approval_row
  FROM public.trader_historical_proposal_ratification_v2
  WHERE proposal_id=proposal_row.id
    AND proposal_content_digest_hex=proposal_row.content_digest_hex
    AND organization_id=proposal_row.organization_id AND run_id=proposal_row.run_id
    AND release_sha=proposal_row.release_sha;

  -- A runner may call this SECURITY DEFINER function, therefore the signed
  -- authority must have one exact semantic shape. Unknown fields are rejected
  -- instead of being silently covered only by a caller-recomputed digest.
  PERFORM public.waia_historical_finalizer_guard_v2(
    (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_authority) keys(key))
      IS DISTINCT FROM ARRAY[
        'aggregateAdmissionContentDigestHex','aggregateAdmissionReceiptId',
        'authorityBoundary','contentDigestHex','developmentDatasetIdentityDigestHex',
        'epistemicRecordCutoff','executionExtent','knowledgeSnapshotDigestHex',
        'knowledgeSnapshots','marketEvidence','marketEvidenceDigestHex',
        'operatorMemberRole','operatorUserId','organizationId','releaseSha','runId',
        'schemaVersion','surfaceAdmissions']::text[],
    'AUTHORITY_EXACT_SHAPE');
  PERFORM public.waia_historical_finalizer_guard_v2(
    (SELECT array_agg(key ORDER BY key)
       FROM jsonb_object_keys(p_authority->'executionExtent') keys(key))
      IS DISTINCT FROM ARRAY['cycleCount','initialRecordIndex']::text[]
    OR (SELECT array_agg(key ORDER BY key)
       FROM jsonb_object_keys(p_authority->'authorityBoundary') keys(key))
      IS DISTINCT FROM ARRAY[
        'blindHoldoutAuthority','capitalAuthority','liveTradingAuthority']::text[],
    'AUTHORITY_NESTED_SHAPE');
  PERFORM public.waia_historical_finalizer_guard_v2(EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_authority->'surfaceAdmissions') a
    WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(a) keys(key))
      IS DISTINCT FROM ARRAY[
        'familyIdentityDigestHex','humanRatificationReceipt','kmGlobalAnchorSetDigestHex',
        'predictivePackageContentDigestHex','predictivePackageGenerationIdentityDigestHex',
        'predictiveTerminalReceipt','scientificAdmissionContentDigestHex',
        'scientificAdmissionEvidenceSemanticDigestHex','scientificAdmissionReceiptId',
      'surfaceKey']::text[]
  ), 'AUTHORITY_SURFACE_EXACT_SHAPE');
  PERFORM public.waia_historical_finalizer_guard_v2(EXISTS (
    SELECT 1
    FROM jsonb_array_elements(proposal_row.technical_candidate_json->'surfaces') c
    WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(c) keys(key))
      IS DISTINCT FROM ARRAY[
        'executionHorizonMinutes','familyIdentityDigestHex','kmGlobalAnchorSetDigestHex',
        'marketBoundaryBar','predictivePackageContentDigestHex',
        'predictivePackageGenerationIdentityDigestHex','predictiveTerminalReceipt',
        'primaryHorizonMinutes','surfaceKey','symbol',
        'volumeQualificationReceiptDigestHex']::text[]
      OR (c->>'executionHorizonMinutes')::integer <>
        (c->>'primaryHorizonMinutes')::integer + 3
  ), 'TECHNICAL_CANDIDATE_SURFACE_EXACT_SHAPE');
  PERFORM public.waia_historical_finalizer_guard_v2(EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_authority->'knowledgeSnapshots') k
    WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k) keys(key))
      IS DISTINCT FROM ARRAY[
        'evidence','hypothesis','knowledgeEdge','lifecycle','marketPitBoundary',
        'observation','organizationId','prediction','releaseSha','runId','schemaVersion',
        'selectedHypothesisId','selectedHypothesisKey','selectedHypothesisType',
        'snapshotContentDigestHex','surfaceKey','trial']::text[]
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k->'hypothesis') keys(key))
        IS DISTINCT FROM ARRAY['createdAt','definitionDigest','hypothesisKey','id']::text[]
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k->'lifecycle') keys(key))
        IS DISTINCT FROM ARRAY['contentDigest','createdAt','id','state']::text[]
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k->'trial') keys(key))
        IS DISTINCT FROM ARRAY['contentDigest','createdAt','eventTime','id','ingestTime']::text[]
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k->'observation') keys(key))
        IS DISTINCT FROM ARRAY['contentDigest','createdAt','eventTime','id','ingestTime']::text[]
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k->'evidence') keys(key))
        IS DISTINCT FROM ARRAY['contentDigest','createdAt','eventTime','id','ingestTime']::text[]
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k->'prediction') keys(key))
        IS DISTINCT FROM ARRAY['id','sealDigestHex']::text[]
      OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(k->'knowledgeEdge') keys(key))
        IS DISTINCT FROM ARRAY['id','sealDigestHex']::text[]
  ), 'AUTHORITY_KNOWLEDGE_EXACT_SHAPE');
  PERFORM public.waia_historical_finalizer_guard_v2(EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_authority->'marketEvidence') e
    WHERE (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(e) keys(key))
      IS DISTINCT FROM ARRAY[
        'contentDigestHex','datasetAuthorityContentDigestHex','datasetAuthorityDigestHex',
        'datasetAuthorityId','membershipContentDigestHex','normalizedInputDigestHex',
        'observationAvailableAt','observationContentDigestHex','observationEventTime',
        'observationId','observationIngestTime','observationSchemaVersion','organizationId',
        'partitionRawSha256Hex','publicAvailableAt','qualificationReceiptDigestHex',
        'releaseSha','runId','schemaVersion','sealedCycleContentDigestHex','sourceId','symbol',
        'trustAsOfReceiptId','trustAuthorityKind','trustRevisionContentDigestHex',
        'trustRevisionId','trustScore','wfPredictiveEndUtc',
        'wfPredictiveSemanticContentDigestHex','wfPredictiveStartUtc']::text[]
  ), 'AUTHORITY_MARKET_EXACT_SHAPE');
  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->>'epistemicRecordCutoff' IS NULL
    OR (p_authority->>'epistemicRecordCutoff')::timestamptz < approval_row.created_at
    OR (p_authority->>'epistemicRecordCutoff')::timestamptz > clock_timestamp(),
    'AUTHORITY_EPISTEMIC_CUTOFF');

  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->>'schemaVersion' <> 'waia.trader.historical_four_surface_ratified_admission.v2'
    OR p_authority->>'organizationId' <> proposal_row.organization_id::text
    OR p_authority->>'runId' <> proposal_row.run_id
    OR p_authority->>'releaseSha' <> proposal_row.release_sha
    OR p_authority->>'operatorUserId' <> approval_row.operator_user_id::text
    OR NOT EXISTS (
      SELECT 1 FROM public.organization_members member
      WHERE member.organization_id=proposal_row.organization_id
        AND member.user_id=approval_row.operator_user_id
        AND member.member_role::text=p_authority->>'operatorMemberRole'
        AND member.member_role IN ('owner','manager')),
    'AUTHORITY_SCOPE');
  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->>'aggregateAdmissionReceiptId' <>
      proposal_row.technical_candidate_json->>'aggregateAdmissionReceiptId'
    OR p_authority->>'aggregateAdmissionContentDigestHex' <>
      proposal_row.technical_candidate_json->>'aggregateAdmissionContentDigestHex'
    OR p_authority->>'developmentDatasetIdentityDigestHex' <>
      proposal_row.technical_candidate_json->>'developmentDatasetIdentityDigestHex',
    'AUTHORITY_AGGREGATE_BINDING');
  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->'executionExtent' IS DISTINCT FROM
      proposal_row.launch_plan_json::jsonb -
        ARRAY['accountId','symbol','primaryHorizonMinutes','startingCashUsdt',
          'defaultQuantity']::text[],
    'AUTHORITY_EXECUTION_EXTENT');
  PERFORM public.waia_historical_finalizer_guard_v2(NOT EXISTS (
    SELECT 1
    FROM public.trader_historical_qualified_execution_extent_v2 qualified
    WHERE qualified.organization_id=proposal_row.organization_id
      AND qualified.run_id=proposal_row.run_id
      AND qualified.release_sha=proposal_row.release_sha
      AND qualified.qualification_receipt_digest_hex=
        proposal_row.technical_candidate_json->>'qualificationReceiptDigestHex'
      AND qualified.first_economic_record_index=
        (proposal_row.technical_candidate_json->>'firstEconomicRecordIndex')::integer
      AND qualified.economic_record_count=
        (proposal_row.technical_candidate_json->>'economicRecordCount')::integer
      AND (proposal_row.launch_plan_json->>'initialRecordIndex')::integer >=
        qualified.first_economic_record_index
      AND (proposal_row.launch_plan_json->>'initialRecordIndex')::integer +
        (proposal_row.launch_plan_json->>'cycleCount')::integer <=
        qualified.first_economic_record_index + qualified.economic_record_count
  ), 'AUTHORITY_QUALIFIED_EXTENT');
  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->'authorityBoundary' <> jsonb_build_object(
      'capitalAuthority','NONE','liveTradingAuthority','NONE',
      'blindHoldoutAuthority','FORBIDDEN_NOT_PRESENT_NOT_ACCESSED'),
    'AUTHORITY_BOUNDARY');
  PERFORM public.waia_historical_finalizer_guard_v2(
    jsonb_array_length(p_authority->'surfaceAdmissions') <> 4
    OR jsonb_array_length(p_authority->'knowledgeSnapshots') <> 4
    OR jsonb_array_length(p_authority->'marketEvidence') <> 2,
    'AUTHORITY_CARDINALITY');
  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->>'contentDigestHex' <> encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(p_authority - 'contentDigestHex'::text),'UTF8')),'hex'),
    'AUTHORITY_CONTENT_DIGEST');
  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->>'knowledgeSnapshotDigestHex' <> encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(jsonb_build_object(
        'schemaVersion','waia.trader.historical_prerun_knowledge_snapshot_set.v2',
        'organizationId',proposal_row.organization_id::text,
        'runId',proposal_row.run_id,'releaseSha',proposal_row.release_sha,
        'epistemicRecordCutoff',p_authority->>'epistemicRecordCutoff',
        'knowledgeSnapshots',p_authority->'knowledgeSnapshots')),'UTF8')),'hex'),
    'AUTHORITY_KNOWLEDGE_SET_DIGEST');
  PERFORM public.waia_historical_finalizer_guard_v2(
    p_authority->>'marketEvidenceDigestHex' <> encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(jsonb_build_object(
        'schemaVersion','waia.trader.historical_ratified_market_evidence_set.v2',
        'organizationId',proposal_row.organization_id::text,
        'runId',proposal_row.run_id,'releaseSha',proposal_row.release_sha,
        'marketEvidence',p_authority->'marketEvidence')),'UTF8')),'hex'),
    'AUTHORITY_MARKET_SET_DIGEST');

  SELECT
    COALESCE(bool_and(
      s.id IS NOT NULL AND aggregate.id IS NOT NULL
      AND candidate.value IS NOT NULL AND frozen.value IS NOT NULL
      AND s.id=(a->>'scientificAdmissionReceiptId')::uuid
      AND s.organization_id=proposal_row.organization_id
      AND s.receipt_kind='WF_PREDICTIVE'
      AND aggregate.receipt_kind='WF_PREDICTIVE_FOUR_SURFACE'
    ),false),
    COALESCE(bool_and(
      s.content_digest IS NOT DISTINCT FROM
        a->>'scientificAdmissionContentDigestHex'
      AND s.evidence_semantic_digest IS NOT DISTINCT FROM
        a->>'scientificAdmissionEvidenceSemanticDigestHex'
      AND s.receipt_json::jsonb->>'contentDigestHex' IS NOT DISTINCT FROM
        s.content_digest
      AND s.receipt_json::jsonb->>'evidenceSemanticDigestHex' IS NOT DISTINCT FROM
        s.evidence_semantic_digest
      AND s.receipt_json::jsonb->'epistemicParameterRatificationReceipt'
        IS NOT DISTINCT FROM a->'humanRatificationReceipt'
    ),false),
    COALESCE(bool_and(
      s.receipt_json::jsonb->'predictiveTerminalReceipt'
        IS NOT DISTINCT FROM a->'predictiveTerminalReceipt'
      AND s.receipt_json::jsonb->'predictiveTerminalReceipt'
        IS NOT DISTINCT FROM candidate.value->'predictiveTerminalReceipt'
    ),false),
    COALESCE(bool_and(public.waia_canonical_jsonb_v1(
      s.receipt_json::jsonb->'kmConvergenceReceipt') IS NOT DISTINCT FROM
      public.waia_canonical_jsonb_v1(frozen.value->'convergenceReceipt')),false),
    COALESCE(bool_and(
      a->'humanRatificationReceipt'->>'kmConvergenceEvidenceSemanticDigestHex'
        IS NOT DISTINCT FROM frozen.value->'convergenceReceipt'->>'evidenceSemanticDigestHex'
    ),false),
    COALESCE(bool_and(
      (a->'humanRatificationReceipt'->>'selectedK')::integer
        IS NOT DISTINCT FROM (frozen.value->'convergenceReceipt'->>'selectedK')::integer
      AND (a->'humanRatificationReceipt'->>'selectedM')::integer
        IS NOT DISTINCT FROM (frozen.value->'convergenceReceipt'->>'selectedM')::integer
    ),false),
    COALESCE(bool_and(a->'humanRatificationReceipt'->>'alphaEpiConfigScale8'
      IS NOT DISTINCT FROM frozen.value->'convergenceReceipt'->>'alphaEpiConfigScale8'),false),
    COALESCE(bool_and(s.km_global_anchor_set_digest IS NOT DISTINCT FROM
      a->>'kmGlobalAnchorSetDigestHex'),false),
    COALESCE(bool_and(s.replica_root_family_identity_digest IS NOT DISTINCT FROM
      a->>'familyIdentityDigestHex'),false),
    COALESCE(bool_and(
      s.selected_package_generation_identity_digest IS NOT DISTINCT FROM
        a->>'predictivePackageGenerationIdentityDigestHex'
      AND s.selected_package_content_digest IS NOT DISTINCT FROM
        a->>'predictivePackageContentDigestHex'
      AND a->>'familyIdentityDigestHex' IS NOT DISTINCT FROM
        candidate.value->>'familyIdentityDigestHex'
      AND a->>'predictivePackageGenerationIdentityDigestHex' IS NOT DISTINCT FROM
        candidate.value->>'predictivePackageGenerationIdentityDigestHex'
      AND a->>'predictivePackageContentDigestHex' IS NOT DISTINCT FROM
        candidate.value->>'predictivePackageContentDigestHex'
      AND a->'humanRatificationReceipt'->>'selectedPackageGenerationIdentityDigestHex'
        IS NOT DISTINCT FROM a->>'predictivePackageGenerationIdentityDigestHex'
      AND a->'humanRatificationReceipt'->>'selectedPackageContentDigestHex'
        IS NOT DISTINCT FROM a->>'predictivePackageContentDigestHex'
    ),false),
    COALESCE(bool_and(
      a->'humanRatificationReceipt'->>'humanReceiptIdentityDigestHex'
        IS NOT DISTINCT FROM encode(sha256(convert_to(
          public.waia_canonical_jsonb_v1(jsonb_build_object(
            'schemaVersion','waia.trader.historical_human_ratification_identity.v2',
            'intent','HUMAN_RATIFY_PREDICTIVE_SURFACE_FOR_HISTORICAL_SIMULATION',
            'organizationId',proposal_row.organization_id::text,
            'runId',proposal_row.run_id,'releaseSha',proposal_row.release_sha,
            'operatorUserId',approval_row.operator_user_id::text,
            'aggregateAdmissionReceiptId',
              proposal_row.technical_candidate_json->>'aggregateAdmissionReceiptId',
            'aggregateAdmissionContentDigestHex',
              proposal_row.technical_candidate_json->>'aggregateAdmissionContentDigestHex',
            'surfaceKey',a->>'surfaceKey',
            'familyIdentityDigestHex',a->>'familyIdentityDigestHex',
            'predictiveTerminalReceiptContentDigestHex',
              a->'predictiveTerminalReceipt'->>'contentDigestHex',
            'kmConvergenceEvidenceSemanticDigestHex',
              frozen.value->'convergenceReceipt'->>'evidenceSemanticDigestHex',
            'selectedK',(frozen.value->'convergenceReceipt'->>'selectedK')::integer,
            'selectedM',(frozen.value->'convergenceReceipt'->>'selectedM')::integer,
            'predictivePackageGenerationIdentityDigestHex',
              a->>'predictivePackageGenerationIdentityDigestHex',
            'predictivePackageContentDigestHex',
              a->>'predictivePackageContentDigestHex'
          )),'UTF8')),'hex')
    ),false),
    COALESCE(bool_and(
      a->'humanRatificationReceipt'->>'contentDigestHex' IS NOT DISTINCT FROM
        public.waia_epistemic_parameter_ratification_v1_content_digest_hex(
          a->'humanRatificationReceipt')
    ),false)
  INTO scientific_row_identity_ok, scientific_receipt_digests_ok,
    scientific_predictive_terminal_ok, scientific_convergence_receipt_ok,
    scientific_human_convergence_digest_ok, scientific_human_selected_km_ok,
    scientific_human_alpha_ok, scientific_global_anchor_ok,
    scientific_family_identity_ok, scientific_selected_package_ok,
    scientific_human_identity_ok,
    scientific_human_content_digest_ok
  FROM jsonb_array_elements(p_authority->'surfaceAdmissions') a
  LEFT JOIN public.trader_scientific_admission_receipt_v1 s
    ON s.id=(a->>'scientificAdmissionReceiptId')::uuid
   AND s.organization_id=proposal_row.organization_id
  LEFT JOIN public.trader_scientific_admission_receipt_v1 aggregate
    ON aggregate.id=(proposal_row.technical_candidate_json->>
      'aggregateAdmissionReceiptId')::uuid
   AND aggregate.organization_id=proposal_row.organization_id
  LEFT JOIN LATERAL jsonb_array_elements(
    proposal_row.technical_candidate_json->'surfaces'
  ) candidate(value) ON candidate.value->>'surfaceKey'=a->>'surfaceKey'
  LEFT JOIN LATERAL jsonb_array_elements(
    aggregate.receipt_json::jsonb#>'{sourceAuthority,contract,surfaces}'
  ) frozen(value) ON aggregate.id IS NOT NULL
    AND frozen.value->>'surfaceKey'=a->>'surfaceKey';

  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_row_identity_ok,'SCIENTIFIC_ROW_IDENTITY');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_receipt_digests_ok,'SCIENTIFIC_RECEIPT_DIGESTS');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_predictive_terminal_ok,'SCIENTIFIC_PREDICTIVE_TERMINAL');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_convergence_receipt_ok,'SCIENTIFIC_CONVERGENCE_RECEIPT');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_human_convergence_digest_ok,'SCIENTIFIC_HUMAN_CONVERGENCE_DIGEST');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_human_selected_km_ok,'SCIENTIFIC_HUMAN_SELECTED_KM');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_human_alpha_ok,'SCIENTIFIC_HUMAN_ALPHA');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_global_anchor_ok,'SCIENTIFIC_GLOBAL_ANCHOR');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_family_identity_ok,'SCIENTIFIC_FAMILY_IDENTITY');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_selected_package_ok,'SCIENTIFIC_SELECTED_PACKAGE');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_human_identity_ok,'SCIENTIFIC_HUMAN_IDENTITY');
  PERFORM public.waia_historical_finalizer_guard_v2(
    NOT scientific_human_content_digest_ok,'SCIENTIFIC_HUMAN_CONTENT_DIGEST');

  IF public.waia_historical_finalizer_guard_v2((
    p_authority->>'schemaVersion' <> 'waia.trader.historical_four_surface_ratified_admission.v2'
    OR p_authority->>'organizationId' <> proposal_row.organization_id::text
    OR p_authority->>'runId' <> proposal_row.run_id
    OR p_authority->>'releaseSha' <> proposal_row.release_sha
    OR p_authority->>'operatorUserId' <> approval_row.operator_user_id::text
    OR p_authority->>'aggregateAdmissionReceiptId' <>
      proposal_row.technical_candidate_json->>'aggregateAdmissionReceiptId'
    OR p_authority->>'aggregateAdmissionContentDigestHex' <>
      proposal_row.technical_candidate_json->>'aggregateAdmissionContentDigestHex'
    OR p_authority->>'developmentDatasetIdentityDigestHex' <>
      proposal_row.technical_candidate_json->>'developmentDatasetIdentityDigestHex'
    OR p_authority->'executionExtent' IS DISTINCT FROM
      proposal_row.launch_plan_json::jsonb -
        ARRAY['accountId','symbol','primaryHorizonMinutes','startingCashUsdt',
          'defaultQuantity']::text[]
    OR NOT EXISTS (
      SELECT 1
      FROM public.trader_historical_qualified_execution_extent_v2 qualified
      WHERE qualified.organization_id=proposal_row.organization_id
        AND qualified.run_id=proposal_row.run_id
        AND qualified.release_sha=proposal_row.release_sha
        AND qualified.qualification_receipt_digest_hex=
          proposal_row.technical_candidate_json->>'qualificationReceiptDigestHex'
        AND qualified.first_economic_record_index=
          (proposal_row.technical_candidate_json->>'firstEconomicRecordIndex')::integer
        AND qualified.economic_record_count=
          (proposal_row.technical_candidate_json->>'economicRecordCount')::integer
        AND (proposal_row.launch_plan_json->>'initialRecordIndex')::integer >=
          qualified.first_economic_record_index
        AND (proposal_row.launch_plan_json->>'initialRecordIndex')::integer +
          (proposal_row.launch_plan_json->>'cycleCount')::integer <=
          qualified.first_economic_record_index + qualified.economic_record_count
    )
    OR p_authority->'authorityBoundary' <> jsonb_build_object(
      'capitalAuthority','NONE','liveTradingAuthority','NONE',
      'blindHoldoutAuthority','FORBIDDEN_NOT_PRESENT_NOT_ACCESSED')
    OR jsonb_array_length(p_authority->'surfaceAdmissions') <> 4
    OR jsonb_array_length(p_authority->'knowledgeSnapshots') <> 4
    OR jsonb_array_length(p_authority->'marketEvidence') <> 2
    OR p_authority->>'contentDigestHex' <> encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(p_authority - 'contentDigestHex'::text),'UTF8')),'hex')
    OR p_authority->>'knowledgeSnapshotDigestHex' <> encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(jsonb_build_object(
        'schemaVersion','waia.trader.historical_prerun_knowledge_snapshot_set.v2',
        'organizationId',proposal_row.organization_id::text,
        'runId',proposal_row.run_id,'releaseSha',proposal_row.release_sha,
        'epistemicRecordCutoff',p_authority->>'epistemicRecordCutoff',
        'knowledgeSnapshots',p_authority->'knowledgeSnapshots')),'UTF8')),'hex')
    OR p_authority->>'marketEvidenceDigestHex' <> encode(sha256(convert_to(
      public.waia_canonical_jsonb_v1(jsonb_build_object(
        'schemaVersion','waia.trader.historical_ratified_market_evidence_set.v2',
        'organizationId',proposal_row.organization_id::text,
        'runId',proposal_row.run_id,'releaseSha',proposal_row.release_sha,
        'marketEvidence',p_authority->'marketEvidence')),'UTF8')),'hex')
    ), 'AUTHORITY_HEADER_OR_DIGEST')
    OR public.waia_historical_finalizer_guard_v2(EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_authority->'knowledgeSnapshots') k
      WHERE k->>'snapshotContentDigestHex' <> encode(sha256(convert_to(
        public.waia_canonical_jsonb_v1(k - 'snapshotContentDigestHex'::text),'UTF8')),'hex')
        OR k->>'organizationId'<>proposal_row.organization_id::text
        OR k->>'runId'<>proposal_row.run_id OR k->>'releaseSha'<>proposal_row.release_sha
        OR k->'lifecycle'->>'state'<>'VALIDATED'
    ), 'KNOWLEDGE_SNAPSHOT_SEAL')
    OR public.waia_historical_finalizer_guard_v2(EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_authority->'knowledgeSnapshots') k
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.trader_mi_hypothesis h
        JOIN public.trader_mi_hypothesis_lifecycle l
          ON l.id=(k->'lifecycle'->>'id')::uuid
         AND l.organization_id=h.organization_id AND l.hypothesis_id=h.id
        JOIN public.trader_mi_trial t
          ON t.id=(k->'trial'->>'id')::uuid
         AND t.organization_id=h.organization_id AND t.hypothesis_id=h.id
        JOIN public.trader_mi_observation o
          ON o.id=(k->'observation'->>'id')::uuid
         AND o.organization_id=h.organization_id
        JOIN public.trader_mi_evidence ev
          ON ev.id=(k->'evidence'->>'id')::uuid
         AND ev.organization_id=h.organization_id AND ev.hypothesis_id=h.id
        JOIN public.trader_market_predictions prediction
          ON prediction.id=(k->'prediction'->>'id')::uuid
         AND prediction.organization_id=h.organization_id
        JOIN public.trader_knowledge_edges edge
          ON edge.id=(k->'knowledgeEdge'->>'id')::uuid
         AND edge.organization_id=h.organization_id
        JOIN LATERAL (
          SELECT surface
          FROM jsonb_array_elements(proposal_row.technical_candidate_json->'surfaces') surface
          WHERE surface->>'surfaceKey'=k->>'surfaceKey'
        ) candidate_surface ON true
        WHERE h.id=(k->'hypothesis'->>'id')::uuid
          AND h.organization_id=proposal_row.organization_id
          AND h.hypothesis_key=k->>'selectedHypothesisKey'
          AND h.hypothesis_key=k->'hypothesis'->>'hypothesisKey'
          AND h.definition_digest=k->'hypothesis'->>'definitionDigest'
          AND h.created_at=(k->'hypothesis'->>'createdAt')::timestamptz
          AND h.name='waia.trader.historical_prerun_knowledge_bootstrap.v2:' ||
            proposal_row.run_id || ':' || (k->>'surfaceKey') || ':' ||
            (k->>'selectedHypothesisType')
          AND (h.definition_json::jsonb->'regimeScope'->>'notes')::jsonb->>
            'organizationId'=proposal_row.organization_id::text
          AND (h.definition_json::jsonb->'regimeScope'->>'notes')::jsonb->>
            'runId'=proposal_row.run_id
          AND (h.definition_json::jsonb->'regimeScope'->>'notes')::jsonb->>
            'releaseSha'=proposal_row.release_sha
          AND (h.definition_json::jsonb->'regimeScope'->>'notes')::jsonb->>
            'surfaceKey'=k->>'surfaceKey'
          AND (h.definition_json::jsonb->'regimeScope'->>'notes')::jsonb->>
            'aggregateAdmissionContentDigestHex'=
              proposal_row.technical_candidate_json->>'aggregateAdmissionContentDigestHex'
          AND (h.definition_json::jsonb->'regimeScope'->>'notes')::jsonb->>
            'qualificationReceiptDigestHex'=
              proposal_row.technical_candidate_json->>'qualificationReceiptDigestHex'
          AND (h.definition_json::jsonb->'regimeScope'->>'notes')::jsonb->>
            'predictivePackageContentDigestHex'=
              candidate_surface.surface->>'predictivePackageContentDigestHex'
          AND l.hypothesis_key=h.hypothesis_key
          AND l.lifecycle_state='VALIDATED'
          AND l.content_digest=k->'lifecycle'->>'contentDigest'
          AND l.created_at=(k->'lifecycle'->>'createdAt')::timestamptz
          AND t.hypothesis_key=h.hypothesis_key
          AND t.hypothesis_definition_digest=h.definition_digest
          AND t.content_digest=k->'trial'->>'contentDigest'
          AND t.event_time=(k->'trial'->>'eventTime')::timestamptz
          AND t.ingest_time=(k->'trial'->>'ingestTime')::timestamptz
          AND t.created_at=(k->'trial'->>'createdAt')::timestamptz
          AND o.content_digest=k->'observation'->>'contentDigest'
          AND o.event_time=(k->'observation'->>'eventTime')::timestamptz
          AND o.ingest_time=(k->'observation'->>'ingestTime')::timestamptz
          AND o.created_at=(k->'observation'->>'createdAt')::timestamptz
          AND ev.hypothesis_key=h.hypothesis_key
          AND ev.hypothesis_definition_digest=h.definition_digest
          AND ev.trial_registration_ref=t.id
          AND ev.observation_refs_json::jsonb @>
            jsonb_build_array(jsonb_build_object('observationId',o.id::text))
          AND ev.content_digest=k->'evidence'->>'contentDigest'
          AND ev.event_time=(k->'evidence'->>'eventTime')::timestamptz
          AND ev.ingest_time=(k->'evidence'->>'ingestTime')::timestamptz
          AND ev.created_at=(k->'evidence'->>'createdAt')::timestamptz
          AND prediction.subject_ref='hypothesis:' || h.id::text
          AND prediction.verification_result='confirmed'
          AND k->'prediction'->>'sealDigestHex'=encode(sha256(convert_to(
            public.waia_canonical_jsonb_v1(jsonb_build_object(
              'schemaVersion','waia.trader.historical_market_prediction_seal.v1',
              'id',prediction.id::text,'organizationId',prediction.organization_id::text,
              'subjectRef',prediction.subject_ref,'predictionJson',prediction.prediction_json,
              'predictedAt',to_char(prediction.predicted_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'outcomeJson',prediction.outcome_json,
              'verifiedAt',CASE WHEN prediction.verified_at IS NULL THEN NULL ELSE
                to_char(prediction.verified_at AT TIME ZONE 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
              'verificationResult',prediction.verification_result,
              'contentDigest',prediction.content_digest,
              'createdAt',to_char(prediction.created_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'UTF8')),'hex')
          AND edge.hypothesis_id=h.id AND edge.from_ref='market_prediction:' || prediction.id::text
          AND edge.to_ref='hypothesis:' || h.id::text AND edge.verified=true
          AND k->'knowledgeEdge'->>'sealDigestHex'=encode(sha256(convert_to(
            public.waia_canonical_jsonb_v1(jsonb_build_object(
              'schemaVersion','waia.trader.historical_knowledge_edge_seal.v1',
              'id',edge.id::text,'organizationId',edge.organization_id::text,
              'fromRef',edge.from_ref,'toRef',edge.to_ref,'relationKind',edge.relation_kind,
              'confidence',edge.confidence,'strength',edge.strength,
              'regimeScope',edge.regime_scope,'failureCasesJson',edge.failure_cases_json,
              'hypothesisId',edge.hypothesis_id::text,'verified',edge.verified,
              'createdAt',to_char(edge.created_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
              'updatedAt',to_char(edge.updated_at AT TIME ZONE 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'UTF8')),'hex')
      )
    ), 'KNOWLEDGE_DURABLE_BINDING')
    OR public.waia_historical_finalizer_guard_v2(EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_authority->'marketEvidence') e
      WHERE e->>'contentDigestHex' <> encode(sha256(convert_to(
        public.waia_canonical_jsonb_v1(e - 'contentDigestHex'::text),'UTF8')),'hex')
        OR e->>'organizationId'<>proposal_row.organization_id::text
        OR e->>'runId'<>proposal_row.run_id OR e->>'releaseSha'<>proposal_row.release_sha
    ), 'MARKET_EVIDENCE_SEAL')
    OR public.waia_historical_finalizer_guard_v2(EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_authority->'marketEvidence') e
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.trader_historical_dataset_authority_v2 dataset
        JOIN public.trader_mi_source source
          ON source.id=(e->>'sourceId')::uuid
         AND source.organization_id=dataset.organization_id
        JOIN public.trader_mi_source_trust revision
          ON revision.id=(e->>'trustRevisionId')::uuid
         AND revision.organization_id=dataset.organization_id
         AND revision.source_id=source.id
        JOIN public.trader_mi_trust_as_of_receipt_v1 trust
          ON trust.id=e->>'trustAsOfReceiptId'
         AND trust.organization_id=dataset.organization_id
         AND trust.source_id=source.id
        JOIN public.trader_mi_observation observation
          ON observation.id=(e->>'observationId')::uuid
         AND observation.organization_id=dataset.organization_id
         AND observation.source_id=source.id
        WHERE dataset.id=(e->>'datasetAuthorityId')::uuid
          AND dataset.organization_id=proposal_row.organization_id
          AND dataset.run_id=proposal_row.run_id
          AND dataset.dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
          AND dataset.authority_content_digest_hex=e->>'datasetAuthorityContentDigestHex'
          AND dataset.dataset_authority_digest_hex=e->>'datasetAuthorityDigestHex'
          AND dataset.membership_content_digest_hex=e->>'membershipContentDigestHex'
          AND dataset.sealed_cycle_content_digest_hex=e->>'sealedCycleContentDigestHex'
          AND dataset.membership_json->>'partitionRawSha256Hex'=e->>'partitionRawSha256Hex'
          AND dataset.membership_json->>'qualificationReceiptDigestHex'=
            proposal_row.technical_candidate_json->>'qualificationReceiptDigestHex'
          AND e->>'qualificationReceiptDigestHex'=
            proposal_row.technical_candidate_json->>'qualificationReceiptDigestHex'
          AND dataset.membership_json->>'symbol'=e->>'symbol'
          AND dataset.membership_json->>'partition'='WALK_FORWARD'
          AND source.venue='htx' AND source.feed_kind='ohlcv_bar'
          AND source.symbol=e->>'symbol' AND source.status='active'
          AND revision.content_digest=e->>'trustRevisionContentDigestHex'
          AND revision.trust_score=e->>'trustScore'
          AND trust.status='RESOLVED'
          AND trust.selected_trust_revision_id=revision.id
          AND trust.selected_content_digest=revision.content_digest
          AND trust.selected_trust_score=revision.trust_score
          AND observation.trust_as_of_receipt_id=trust.id
          AND observation.source_trust_revision_id=revision.id
          AND observation.source_trust_content_digest=revision.content_digest
          AND observation.content_digest=e->>'observationContentDigestHex'
          AND observation.schema_version=e->>'observationSchemaVersion'
          AND observation.event_time=(e->>'observationEventTime')::timestamptz
          AND observation.available_at=(e->>'observationAvailableAt')::timestamptz
          AND observation.ingest_time=(e->>'observationIngestTime')::timestamptz
          AND observation.normalized_input_digest=e->>'normalizedInputDigestHex'
          AND e->>'publicAvailableAt'=e->>'observationEventTime'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(proposal_row.technical_candidate_json->'surfaces') surface
            WHERE surface->>'symbol'=e->>'symbol'
              AND surface->>'volumeQualificationReceiptDigestHex' IS NOT NULL
          )
      )
    ), 'MARKET_EVIDENCE_DURABLE_BINDING')
    OR public.waia_historical_finalizer_guard_v2(EXISTS (
      SELECT 1 FROM jsonb_array_elements(proposal_row.technical_candidate_json->'surfaces') c
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_authority->'surfaceAdmissions') a
        WHERE a->>'surfaceKey'=c->>'surfaceKey'
          AND a->>'familyIdentityDigestHex'=c->>'familyIdentityDigestHex'
          AND a->>'predictivePackageGenerationIdentityDigestHex'=
            c->>'predictivePackageGenerationIdentityDigestHex'
          AND a->>'predictivePackageContentDigestHex'=c->>'predictivePackageContentDigestHex'
      )
    ), 'TECHNICAL_SURFACE_COVERAGE')
    OR public.waia_historical_finalizer_guard_v2(NOT EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id=proposal_row.organization_id
        AND m.user_id=approval_row.operator_user_id
        AND m.member_role IN ('owner','manager')
    ), 'OPERATOR_MEMBERSHIP')
  THEN
    RAISE EXCEPTION 'historical final authority is not bound to approved proposal'
      USING ERRCODE='check_violation';
  END IF;

  SELECT id INTO existing_id
  FROM public.trader_historical_four_surface_ratified_admission_v2
  WHERE organization_id=proposal_row.organization_id AND run_id=proposal_row.run_id;
  IF existing_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.trader_historical_four_surface_ratified_admission_v2
      WHERE id=existing_id AND authority_content_digest_hex=p_authority->>'contentDigestHex'
        AND authority_json=p_authority
    ) THEN
      RAISE EXCEPTION 'conflicting historical final authority' USING ERRCODE='check_violation';
    END IF;
    RETURN existing_id;
  END IF;

  INSERT INTO public.trader_historical_four_surface_ratified_admission_v2 (
    id,organization_id,run_id,release_sha,aggregate_admission_receipt_id,
    aggregate_admission_content_digest_hex,development_dataset_identity_digest_hex,
    operator_user_id,surface_admissions_json,knowledge_snapshots_json,
    knowledge_snapshot_digest_hex,market_evidence_json,market_evidence_digest_hex,
    authority_json,authority_content_digest_hex,schema_version,created_at
  ) VALUES (
    inserted_id,proposal_row.organization_id,proposal_row.run_id,proposal_row.release_sha,
    (p_authority->>'aggregateAdmissionReceiptId')::uuid,
    p_authority->>'aggregateAdmissionContentDigestHex',
    p_authority->>'developmentDatasetIdentityDigestHex',approval_row.operator_user_id,
    p_authority->'surfaceAdmissions',p_authority->'knowledgeSnapshots',
    p_authority->>'knowledgeSnapshotDigestHex',p_authority->'marketEvidence',
    p_authority->>'marketEvidenceDigestHex',p_authority,p_authority->>'contentDigestHex',
    p_authority->>'schemaVersion',(p_authority->>'epistemicRecordCutoff')::timestamptz
  );
  RETURN inserted_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.waia_finalize_historical_four_surface_authority_v2(
  uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waia_finalize_historical_four_surface_authority_v2(
  uuid,text,text,jsonb) TO waia_historical_runner;
--> statement-breakpoint
-- Historical computation cannot occupy the live/paper GENERAL namespace or
-- manufacture a checkpoint for an unapproved run. This is invoker-side RLS;
-- the authority table itself only exposes an exact Human-approved authority.
DROP POLICY IF EXISTS waia_historical_runner_org_select_v2
  ON public.trader_knowledge_state_checkpoint_v2;
DROP POLICY IF EXISTS waia_historical_runner_org_insert_v2
  ON public.trader_knowledge_state_checkpoint_v2;
CREATE POLICY historical_approved_checkpoint_select_v2
  ON public.trader_knowledge_state_checkpoint_v2
  FOR SELECT TO waia_historical_runner
  USING (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND checkpoint_namespace=model_version
    AND EXISTS (
      SELECT 1 FROM public.trader_historical_four_surface_ratified_admission_v2 authority
      CROSS JOIN LATERAL jsonb_array_elements(authority.surface_admissions_json) surface(value)
      WHERE authority.organization_id=trader_knowledge_state_checkpoint_v2.organization_id
        AND surface.value->>'surfaceKey' IN ('BTCUSDT:30','BTCUSDT:60','ETHUSDT:30','ETHUSDT:60')
        AND checkpoint_namespace='waia.trader.historical_simulation_knowledge_binding.v2|'
          ||authority.run_id||'|'||split_part(surface.value->>'surfaceKey',':',1)||'|historical-simulation-v2'
    )
  );
CREATE POLICY historical_approved_checkpoint_insert_v2
  ON public.trader_knowledge_state_checkpoint_v2
  FOR INSERT TO waia_historical_runner
  WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND checkpoint_namespace=model_version
    AND EXISTS (
      SELECT 1 FROM public.trader_historical_four_surface_ratified_admission_v2 authority
      CROSS JOIN LATERAL jsonb_array_elements(authority.surface_admissions_json) surface(value)
      WHERE authority.organization_id=trader_knowledge_state_checkpoint_v2.organization_id
        AND surface.value->>'surfaceKey' IN ('BTCUSDT:30','BTCUSDT:60','ETHUSDT:30','ETHUSDT:60')
        AND checkpoint_namespace='waia.trader.historical_simulation_knowledge_binding.v2|'
          ||authority.run_id||'|'||split_part(surface.value->>'surfaceKey',':',1)||'|historical-simulation-v2'
    )
  );
