-- DEE-1132 source reservation0223. Apply only with the root-integrated complete0222 predecessor chain.
-- New research-only sidecars; no changes to canonical, Core audit or existing authority tables.
--> statement-breakpoint
CREATE TABLE trader_research_application_assignments_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (octet_length(body_json) <= 65536
    AND jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.research_application_assignment.v1'
    AND body_json::jsonb->>'authority' IS NOT DISTINCT FROM 'RESEARCH_APPLICATION_ONLY'
    AND body_json::jsonb->>'purpose' IS NOT DISTINCT FROM 'RESEARCH_NON_CAPITAL'
    AND body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND content_digest = encode(sha256(convert_to(body_json,'UTF8')),'hex')),
  runtime_instance_id text NOT NULL CHECK (length(btrim(runtime_instance_id))>0),
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^[0-9a-f]{64}$'),
  research_session_id text NOT NULL, research_assignment_digest text NOT NULL,
  PRIMARY KEY(organization_id,assignment_digest),
  FOREIGN KEY(organization_id,research_session_id,research_assignment_digest)
    REFERENCES trader_research_understanding_assignments_v1(organization_id,session_id,content_digest),
  CHECK (body_json::jsonb->'configuration'->>'researchSessionId' IS NOT DISTINCT FROM research_session_id
    AND body_json::jsonb->'configuration'->>'researchAssignmentDigest' IS NOT DISTINCT FROM research_assignment_digest)
);
--> statement-breakpoint
CREATE TABLE trader_research_applications_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (octet_length(body_json) <= 524288
    AND jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.research_application_record.v1'
    AND body_json::jsonb->>'authority' IS NOT DISTINCT FROM 'RESEARCH_APPLICATION_ONLY'
    AND body_json::jsonb->>'purpose' IS NOT DISTINCT FROM 'RESEARCH_NON_CAPITAL'
    AND body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND content_digest = encode(sha256(convert_to(body_json,'UTF8')),'hex')),
  runtime_instance_id text NOT NULL CHECK (length(btrim(runtime_instance_id))>0),
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  application_id text NOT NULL CHECK (application_id ~ '^[0-9a-f]{64}$'), assignment_digest text NOT NULL,
  previous_source_sequence bigint NOT NULL CHECK (previous_source_sequence BETWEEN 0 AND 9007199254740990),
  current_source_sequence bigint NOT NULL CHECK (current_source_sequence = previous_source_sequence+1),
  recorded_at timestamptz NOT NULL, audit_id uuid NOT NULL REFERENCES audit_logs(id),
  PRIMARY KEY(organization_id,application_id), UNIQUE(organization_id,application_id,content_digest),
  UNIQUE(organization_id,assignment_digest,previous_source_sequence,current_source_sequence),
  FOREIGN KEY(organization_id,assignment_digest) REFERENCES trader_research_application_assignments_v1(organization_id,assignment_digest),
  CHECK (body_json::jsonb->>'applicationId' IS NOT DISTINCT FROM application_id
    AND body_json::jsonb->>'assignmentDigest' IS NOT DISTINCT FROM assignment_digest
    AND (body_json::jsonb->>'recordedAt')::timestamptz IS NOT DISTINCT FROM recorded_at
    AND (body_json::jsonb->'previous'->>'sourceSequence')::bigint IS NOT DISTINCT FROM previous_source_sequence
    AND (body_json::jsonb->'current'->>'sourceSequence')::bigint IS NOT DISTINCT FROM current_source_sequence)
);
--> statement-breakpoint
CREATE TABLE trader_research_application_availability_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (octet_length(body_json) <= 4096
    AND jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.research_application_availability.v1'
    AND body_json::jsonb->>'authority' IS NOT DISTINCT FROM 'RESEARCH_APPLICATION_ONLY'
    AND body_json::jsonb->>'purpose' IS NOT DISTINCT FROM 'RESEARCH_NON_CAPITAL'
    AND body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND content_digest = encode(sha256(convert_to(body_json,'UTF8')),'hex')),
  runtime_instance_id text NOT NULL CHECK (length(btrim(runtime_instance_id))>0),
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  application_id text NOT NULL, application_digest text NOT NULL, available_at timestamptz NOT NULL,
  audit_id uuid NOT NULL REFERENCES audit_logs(id),
  PRIMARY KEY(organization_id,application_id), UNIQUE(organization_id,application_id,content_digest),
  FOREIGN KEY(organization_id,application_id,application_digest) REFERENCES trader_research_applications_v1(organization_id,application_id,content_digest),
  CHECK (body_json::jsonb->>'applicationId' IS NOT DISTINCT FROM application_id
    AND body_json::jsonb->>'applicationDigest' IS NOT DISTINCT FROM application_digest
    AND (body_json::jsonb->>'availableAt')::timestamptz IS NOT DISTINCT FROM available_at)
);
--> statement-breakpoint
CREATE TABLE trader_research_application_consumptions_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (octet_length(body_json) <= 524288
    AND jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.research_application_consumption.v1'
    AND body_json::jsonb->>'authority' IS NOT DISTINCT FROM 'RESEARCH_APPLICATION_ONLY'
    AND body_json::jsonb->>'purpose' IS NOT DISTINCT FROM 'RESEARCH_NON_CAPITAL'
    AND body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND content_digest = encode(sha256(convert_to(body_json,'UTF8')),'hex')),
  runtime_instance_id text NOT NULL CHECK (length(btrim(runtime_instance_id))>0),
  lease_epoch integer NOT NULL CHECK (lease_epoch>0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  assignment_digest text NOT NULL, application_id text NOT NULL, application_digest text NOT NULL, availability_digest text NOT NULL,
  consumer_source_session_id text NOT NULL, consumer_source_sequence bigint NOT NULL CHECK (consumer_source_sequence BETWEEN 0 AND 9007199254740991),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991), previous_consumption_digest text,
  audit_id uuid NOT NULL REFERENCES audit_logs(id),
  PRIMARY KEY(organization_id,assignment_digest,sequence),
  UNIQUE(organization_id,assignment_digest,application_id,consumer_source_session_id,consumer_source_sequence),
  FOREIGN KEY(organization_id,application_id,application_digest) REFERENCES trader_research_applications_v1(organization_id,application_id,content_digest),
  FOREIGN KEY(organization_id,application_id,availability_digest) REFERENCES trader_research_application_availability_v1(organization_id,application_id,content_digest),
  CHECK (body_json::jsonb->>'applicationId' IS NOT DISTINCT FROM application_id
    AND body_json::jsonb->>'applicationDigest' IS NOT DISTINCT FROM application_digest
    AND body_json::jsonb->>'assignmentDigest' IS NOT DISTINCT FROM assignment_digest
    AND body_json::jsonb->>'availabilityDigest' IS NOT DISTINCT FROM availability_digest
    AND body_json::jsonb->'consumer'->>'sourceSessionId' IS NOT DISTINCT FROM consumer_source_session_id
    AND (body_json::jsonb->'consumer'->>'sourceSequence')::bigint IS NOT DISTINCT FROM consumer_source_sequence
    AND (body_json::jsonb->>'sequence')::bigint IS NOT DISTINCT FROM sequence
    AND body_json::jsonb->>'previousConsumptionDigest' IS NOT DISTINCT FROM previous_consumption_digest)
);
--> statement-breakpoint
CREATE FUNCTION trader_research_application_v1_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb; payload jsonb; feature jsonb; field record; payload_text text; config jsonb; app jsonb; available jsonb; saved jsonb; pin jsonb; witness jsonb;
  projection jsonb; expected_inputs jsonb; actual_inputs jsonb; previous text; operation text; selected_assignment text;
BEGIN
  -- Admission before this verifier parses any body. The table CHECK remains independent.
  IF octet_length(NEW.body_json) > CASE TG_TABLE_NAME
    WHEN 'trader_research_application_assignments_v1' THEN 65536
    WHEN 'trader_research_application_availability_v1' THEN 4096 ELSE 524288 END
    THEN RAISE EXCEPTION 'APPLICATION_BODY_LIMIT'; END IF;
  b := NEW.body_json::jsonb;
  IF TG_TABLE_NAME = 'trader_research_application_assignments_v1' THEN
    config := b->'configuration';
    SELECT body_json::jsonb INTO saved FROM trader_research_understanding_assignments_v1
      WHERE organization_id=NEW.organization_id AND session_id=NEW.research_session_id AND content_digest=NEW.research_assignment_digest;
    IF saved IS NULL OR config->>'organizationId' IS DISTINCT FROM NEW.organization_id::text
      OR config->>'accountId' IS DISTINCT FROM saved->>'accountId' OR config->>'symbol' IS DISTINCT FROM saved->>'symbol'
      OR config->>'sourceSessionId' IS DISTINCT FROM saved->>'sourceSessionId' OR config->>'sourceConfigDigest' IS DISTINCT FROM saved->>'sourceConfigDigest'
      OR config->>'profileId' IS DISTINCT FROM saved->>'profileId' OR config->>'profileContentDigest' IS DISTINCT FROM saved->>'profileContentDigest'
      OR config->>'computation' IS DISTINCT FROM saved->'declarations'->>'computation'
      OR config->>'computationManifestDigest' IS DISTINCT FROM saved->'declarations'->>'computationManifestDigest'
      OR NOT EXISTS(SELECT 1 FROM trader_mi_hypothesis WHERE organization_id=NEW.organization_id AND id::text=config->>'hypothesisId'
        AND hypothesis_key=config->>'hypothesisKey' AND version_seq=(config->>'hypothesisVersion')::integer AND definition_digest=config->>'hypothesisDefinitionDigest')
      OR NOT EXISTS(SELECT 1 FROM trader_mi_measurement WHERE organization_id=NEW.organization_id AND id::text=config->>'measurementId'
        AND measurement_key=config->>'measurementKey' AND version_seq=(config->>'measurementVersion')::integer AND definition_digest=config->>'measurementDefinitionDigest')
      THEN RAISE EXCEPTION 'APPLICATION_ASSIGNMENT_LINK_CONFLICT'; END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'trader_research_applications_v1' THEN
    operation := 'apply'; selected_assignment := NEW.assignment_digest;
    SELECT body_json::jsonb->'configuration' INTO config FROM trader_research_application_assignments_v1
      WHERE organization_id=NEW.organization_id AND assignment_digest=NEW.assignment_digest;
    IF config IS NULL OR b->'configuration' IS DISTINCT FROM config OR jsonb_typeof(b->'witnesses') IS DISTINCT FROM 'array'
      OR jsonb_array_length(b->'witnesses') IS DISTINCT FROM 2
      OR NOT (NEW.recorded_at > (b->'current'->>'analysisPitAnchor')::timestamptz
        AND (b->'current'->>'analysisPitAnchor')::timestamptz > (b->'previous'->>'analysisPitAnchor')::timestamptz)
      THEN RAISE EXCEPTION 'APPLICATION_BODY_LINK_CONFLICT'; END IF;
    FOR pin IN SELECT value FROM jsonb_array_elements(jsonb_build_array(b->'previous',b->'current')) LOOP
      SELECT body_json::jsonb || jsonb_build_object('contentDigest',content_digest) INTO saved
        FROM trader_research_understanding_completions_v1 WHERE organization_id=NEW.organization_id
        AND session_id=config->>'researchSessionId' AND source_session_id=pin->>'sourceSessionId'
        AND source_sequence=(pin->>'sourceSequence')::bigint AND content_digest=pin->>'completionDigest';
      IF saved IS NULL OR saved->>'assignmentDigest' IS DISTINCT FROM config->>'researchAssignmentDigest'
        OR saved->>'packetDigest' IS DISTINCT FROM pin->>'packetDigest' OR saved->'output'->>'contentDigest' IS DISTINCT FROM pin->>'evaluationDigest'
        OR saved->'output'->'receipt'->>'id' IS DISTINCT FROM pin->>'receiptId'
        OR saved->'output'->'receipt'->>'contentDigest' IS DISTINCT FROM pin->>'receiptDigest'
        OR saved->'output'->>'analysisPitAnchor' IS DISTINCT FROM pin->>'analysisPitAnchor'
        THEN RAISE EXCEPTION 'APPLICATION_COMPLETION_LINK_CONFLICT'; END IF;
    END LOOP;
    IF b->'meaning'->>'disposition' IN ('OBSERVED_FOR','OBSERVED_AGAINST') THEN
      IF jsonb_typeof(b->'evidence') IS DISTINCT FROM 'object' OR jsonb_typeof(b->'relation') IS DISTINCT FROM 'object'
        OR b->'relation'->>'verified' IS DISTINCT FROM 'false' OR b->'relation'->>'confidenceState' IS DISTINCT FROM 'NOT_ASSESSED'
        OR b->'relation'->>'authority' IS DISTINCT FROM 'RESEARCH_APPLICATION_ONLY'
        OR b->'relation'->>'purpose' IS DISTINCT FROM 'RESEARCH_NON_CAPITAL'
        OR b->'relation'->>'applicationId' IS DISTINCT FROM NEW.application_id
        OR b->'relation'->>'evidenceId' IS DISTINCT FROM b->'evidence'->>'id'
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'witnesses') w WHERE w='null'::jsonb)
        THEN RAISE EXCEPTION 'APPLICATION_RESEARCH_RELATION_CONFLICT'; END IF;
    ELSIF b->'evidence' IS DISTINCT FROM 'null'::jsonb OR b->'relation' IS DISTINCT FROM 'null'::jsonb
      THEN RAISE EXCEPTION 'APPLICATION_UNASSESSED_RELATION_CONFLICT'; END IF;
    FOR witness IN SELECT value FROM jsonb_array_elements(b->'witnesses') WHERE value<>'null'::jsonb LOOP
      -- Exact retained representation, not an inferred digest label or recursive SQL canonicalizer.
      IF jsonb_typeof(witness) IS DISTINCT FROM 'object' OR octet_length(witness::text)>262144
        OR jsonb_typeof(witness->'payload') IS DISTINCT FROM 'object'
        OR jsonb_typeof(witness->'payloadCanonical') IS DISTINCT FROM 'string'
        THEN RAISE EXCEPTION 'APPLICATION_WITNESS_REPRESENTATION_INVALID'; END IF;
      payload := witness->'payload'; payload_text := witness->>'payloadCanonical';
      IF octet_length(payload_text)>262144 THEN RAISE EXCEPTION 'APPLICATION_WITNESS_REPRESENTATION_LIMIT'; END IF;
      -- The fixed producer shape has no recursive object/array leaves. No formula or threshold is evaluated here.
      IF payload - ARRAY['schemaVersion','authority','purpose','commandManifestDigest','packetDigest','fullBarsDigest','quoteDigest','features'] <> '{}'::jsonb
        OR payload->>'schemaVersion' IS DISTINCT FROM 'waia.trader.research_application_feature_witness.v1'
        OR payload->>'authority' IS DISTINCT FROM 'RESEARCH_APPLICATION_ONLY'
        OR payload->>'purpose' IS DISTINCT FROM 'RESEARCH_NON_CAPITAL'
        OR jsonb_typeof(payload->'features') IS DISTINCT FROM 'object'
        THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      FOREACH payload_text IN ARRAY ARRAY['schemaVersion','authority','purpose','commandManifestDigest','packetDigest','fullBarsDigest','quoteDigest'] LOOP
        IF jsonb_typeof(payload->payload_text) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      END LOOP;
      feature := payload->'features';
      IF feature - ARRAY['featureSetId','instrumentId','evaluatedAt','features','dataQualityScore','inputs'] <> '{}'::jsonb
        OR jsonb_typeof(feature->'dataQualityScore') IS DISTINCT FROM 'number'
        OR jsonb_typeof(feature->'features') IS DISTINCT FROM 'object'
        OR jsonb_typeof(feature->'inputs') IS DISTINCT FROM 'object'
        THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      FOREACH payload_text IN ARRAY ARRAY['featureSetId','instrumentId','evaluatedAt'] LOOP
        IF jsonb_typeof(feature->payload_text) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      END LOOP;
      IF (feature->'features') - ARRAY['close','sma20','zscoreVsSma20','priceDispersion20','spreadBps','realizedVar20m_1m','realizedVol20m_1m'] <> '{}'::jsonb
        OR (feature->'inputs') - ARRAY['barCount','latestQuoteAgeMs'] <> '{}'::jsonb
        OR jsonb_typeof(feature->'inputs'->'barCount') IS DISTINCT FROM 'number'
        THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      FOREACH payload_text IN ARRAY ARRAY['close','sma20','zscoreVsSma20','priceDispersion20','spreadBps'] LOOP
        IF jsonb_typeof(feature->'features'->payload_text) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      END LOOP;
      FOR field IN SELECT * FROM jsonb_each(feature->'features') LOOP
        IF jsonb_typeof(field.value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      END LOOP;
      FOR field IN SELECT * FROM jsonb_each(feature->'inputs') LOOP
        IF jsonb_typeof(field.value) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'APPLICATION_WITNESS_SHAPE_INVALID'; END IF;
      END LOOP;
      payload_text := witness->>'payloadCanonical';
      IF payload_text::jsonb IS DISTINCT FROM payload
        OR encode(sha256(convert_to(payload_text,'UTF8')),'hex') IS DISTINCT FROM witness->'value'->>'outputContentDigest'
        THEN RAISE EXCEPTION 'APPLICATION_WITNESS_PAYLOAD_CONFLICT'; END IF;
      IF NOT EXISTS(SELECT 1 FROM trader_mi_canonical_measurement_definition_v1 WHERE organization_id=NEW.organization_id
          AND id=witness->'definition'->>'id' AND content_digest=witness->'definition'->>'contentDigest' AND definition_json=witness->'definition') OR
        NOT EXISTS(SELECT 1 FROM trader_mi_canonical_measurement_value_v1 WHERE organization_id=NEW.organization_id
          AND id=witness->'value'->>'id' AND content_digest=witness->'value'->>'contentDigest'
          AND definition_id=witness->'definition'->>'id' AND definition_content_digest=witness->'definition'->>'contentDigest'
          AND input_lineage_json=witness->'value'->'inputs' AND output_content_digest=witness->'value'->>'outputContentDigest')
        THEN RAISE EXCEPTION 'APPLICATION_CANONICAL_LINK_CONFLICT'; END IF;
      SELECT jsonb_agg(to_jsonb(i)-'created_at' ORDER BY input_ordinal) INTO actual_inputs
        FROM trader_mi_canonical_measurement_value_input_v1 i WHERE organization_id=NEW.organization_id AND measurement_value_id=witness->'value'->>'id';
      SELECT jsonb_agg(jsonb_build_object('organization_id',NEW.organization_id,'measurement_value_id',witness->'value'->>'id','input_ordinal',ord-1,
        'observation_id',v->>'observationId','observation_kind',v->>'observationKind','observation_schema_version',v->>'observationSchemaVersion',
        'observation_content_digest',v->>'observationContentDigest','source_id',v->>'sourceId','trust_as_of_receipt_id',v->>'trustAsOfReceiptId',
        'trust_revision_id',v->>'trustRevisionId','trust_revision_content_digest',v->>'trustRevisionContentDigest') ORDER BY ord)
        INTO expected_inputs FROM jsonb_array_elements(witness->'value'->'inputs') WITH ORDINALITY a(v,ord);
      IF actual_inputs IS DISTINCT FROM expected_inputs THEN RAISE EXCEPTION 'APPLICATION_CANONICAL_INPUT_CONFLICT'; END IF;
    END LOOP;
  ELSE
    SELECT body_json::jsonb INTO app FROM trader_research_applications_v1 WHERE organization_id=NEW.organization_id
      AND application_id=NEW.application_id AND content_digest=NEW.application_digest;
    IF app IS NULL THEN RAISE EXCEPTION 'APPLICATION_PARENT_MISSING'; END IF;
    selected_assignment := app->>'assignmentDigest';
    IF TG_TABLE_NAME = 'trader_research_application_availability_v1' THEN
      operation := 'availability';
      IF NEW.available_at < (app->>'recordedAt')::timestamptz THEN RAISE EXCEPTION 'APPLICATION_AVAILABILITY_TIME_INVALID'; END IF;
    ELSE
      operation := 'consume';
      SELECT body_json::jsonb INTO available FROM trader_research_application_availability_v1 WHERE organization_id=NEW.organization_id
        AND application_id=NEW.application_id AND content_digest=NEW.availability_digest;
      config := app->'configuration'; pin := b->'consumer';
      SELECT body_json::jsonb INTO saved FROM trader_research_understanding_completions_v1 WHERE organization_id=NEW.organization_id
        AND session_id=config->>'researchSessionId' AND source_session_id=NEW.consumer_source_session_id
        AND source_sequence=NEW.consumer_source_sequence AND content_digest=pin->>'completionDigest';
      IF available IS NULL OR saved IS NULL OR NEW.assignment_digest IS DISTINCT FROM selected_assignment
        OR saved->>'assignmentDigest' IS DISTINCT FROM config->>'researchAssignmentDigest'
        OR saved->>'packetDigest' IS DISTINCT FROM pin->>'packetDigest' OR saved->'output'->>'contentDigest' IS DISTINCT FROM pin->>'evaluationDigest'
        OR saved->'output'->>'analysisPitAnchor' IS DISTINCT FROM pin->>'analysisPitAnchor'
        OR NOT (NEW.consumer_source_sequence>(app->'current'->>'sourceSequence')::bigint
          AND (pin->>'analysisPitAnchor')::timestamptz>(available->>'availableAt')::timestamptz)
        THEN RAISE EXCEPTION 'APPLICATION_CONSUMER_LINK_CONFLICT'; END IF;
      IF NEW.sequence=0 THEN
        IF NEW.previous_consumption_digest IS NOT NULL THEN RAISE EXCEPTION 'APPLICATION_CONSUMPTION_PREFIX_CONFLICT'; END IF;
      ELSE
        SELECT content_digest INTO previous FROM trader_research_application_consumptions_v1 WHERE organization_id=NEW.organization_id
          AND assignment_digest=NEW.assignment_digest AND sequence=NEW.sequence-1;
        IF previous IS NULL OR previous IS DISTINCT FROM NEW.previous_consumption_digest THEN RAISE EXCEPTION 'APPLICATION_CONSUMPTION_PREFIX_CONFLICT'; END IF;
      END IF;
    END IF;
  END IF;
  SELECT jsonb_build_object('organizationId',organization_id,'actorType',actor_type,'actorId',actor_id,
    'action',action,'entityType',entity_type,'entityId',entity_id,'metadata',metadata_json) INTO projection FROM audit_logs WHERE id=NEW.audit_id;
  IF projection IS DISTINCT FROM jsonb_build_object('organizationId',NEW.organization_id,
    'actorType',CASE WHEN b->'actor'->>'kind'='USER' THEN 'user' ELSE 'service' END,'actorId',b->'actor'->>'id',
    'action','trader.research_application.'||operation,'entityType','trader_research_application','entityId',NEW.application_id,
    'metadata',jsonb_build_object('operation',operation,'applicationId',NEW.application_id,'assignmentDigest',selected_assignment,
      'bodyDigest',NEW.content_digest,'actor',b->'actor','holder',jsonb_build_object('runtimeInstanceId',NEW.runtime_instance_id,
        'leaseEpoch',NEW.lease_epoch,'leaseContentDigest',NEW.lease_content_digest)))
    THEN RAISE EXCEPTION 'APPLICATION_AUDIT_LINK_CONFLICT'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ra_assignment_links BEFORE INSERT ON trader_research_application_assignments_v1 FOR EACH ROW EXECUTE FUNCTION trader_research_application_v1_links();
--> statement-breakpoint
CREATE TRIGGER ra_assignment_immutable BEFORE UPDATE OR DELETE ON trader_research_application_assignments_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ra_assignment_fence AFTER INSERT ON trader_research_application_assignments_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_research_application_assignments_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ra_assignment_browser_deny ON trader_research_application_assignments_v1 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE TRIGGER ra_application_links BEFORE INSERT ON trader_research_applications_v1 FOR EACH ROW EXECUTE FUNCTION trader_research_application_v1_links();
--> statement-breakpoint
CREATE TRIGGER ra_application_immutable BEFORE UPDATE OR DELETE ON trader_research_applications_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ra_application_fence AFTER INSERT ON trader_research_applications_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_research_applications_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ra_application_browser_deny ON trader_research_applications_v1 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE TRIGGER ra_availability_links BEFORE INSERT ON trader_research_application_availability_v1 FOR EACH ROW EXECUTE FUNCTION trader_research_application_v1_links();
--> statement-breakpoint
CREATE TRIGGER ra_availability_immutable BEFORE UPDATE OR DELETE ON trader_research_application_availability_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ra_availability_fence AFTER INSERT ON trader_research_application_availability_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_research_application_availability_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ra_availability_browser_deny ON trader_research_application_availability_v1 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE TRIGGER ra_consumption_links BEFORE INSERT ON trader_research_application_consumptions_v1 FOR EACH ROW EXECUTE FUNCTION trader_research_application_v1_links();
--> statement-breakpoint
CREATE TRIGGER ra_consumption_immutable BEFORE UPDATE OR DELETE ON trader_research_application_consumptions_v1 FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ra_consumption_fence AFTER INSERT ON trader_research_application_consumptions_v1 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_research_application_consumptions_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ra_consumption_browser_deny ON trader_research_application_consumptions_v1 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
