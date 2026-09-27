-- DEE-1126: owned research assignment/completion only. No generic source trust or capital authority.
CREATE TABLE trader_research_understanding_assignments_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  session_id text NOT NULL CHECK (length(btrim(session_id)) > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.saved_research_understanding.v1'
    AND content_digest = encode(sha256(convert_to(body_json, 'UTF8')), 'hex') AND octet_length(body_json) <= 131072),
  runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch > 0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  profile_id text NOT NULL, profile_content_digest text NOT NULL,
  source_session_id text NOT NULL, source_config_digest text NOT NULL,
  PRIMARY KEY (organization_id, session_id), UNIQUE (organization_id, session_id, content_digest),
  FOREIGN KEY (profile_id, organization_id, profile_content_digest)
    REFERENCES trader_required_information_profile_v2(id, organization_id, content_digest),
  FOREIGN KEY (organization_id, source_session_id, source_config_digest)
    REFERENCES trader_recorded_analysis_sessions_v1(organization_id, session_id, content_digest),
  CHECK (body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_json::jsonb->>'researchSessionId' IS NOT DISTINCT FROM session_id
    AND body_json::jsonb->>'profileId' IS NOT DISTINCT FROM profile_id
    AND body_json::jsonb->>'profileContentDigest' IS NOT DISTINCT FROM profile_content_digest
    AND body_json::jsonb->>'sourceSessionId' IS NOT DISTINCT FROM source_session_id
    AND body_json::jsonb->>'sourceConfigDigest' IS NOT DISTINCT FROM source_config_digest)
);
--> statement-breakpoint
CREATE TABLE trader_research_understanding_completions_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  session_id text NOT NULL CHECK (length(btrim(session_id)) > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.saved_research_understanding.v1'
    AND content_digest = encode(sha256(convert_to(body_json, 'UTF8')), 'hex') AND octet_length(body_json) <= 2097152),
  runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch > 0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991),
  assignment_digest text NOT NULL, source_session_id text NOT NULL,
  source_sequence bigint NOT NULL CHECK (source_sequence BETWEEN 0 AND 9007199254740991),
  packet_digest text NOT NULL, receipt_id text NOT NULL REFERENCES trader_information_sufficiency_receipt_v2(id),
  previous_completion_digest text,
  PRIMARY KEY (organization_id, session_id, sequence), UNIQUE (organization_id, session_id, content_digest),
  FOREIGN KEY (organization_id, session_id, assignment_digest)
    REFERENCES trader_research_understanding_assignments_v1(organization_id, session_id, content_digest),
  FOREIGN KEY (organization_id, source_session_id, source_sequence, packet_digest)
    REFERENCES trader_recorded_analysis_packets_v1(organization_id, session_id, sequence, content_digest),
  CHECK (body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_json::jsonb->>'researchSessionId' IS NOT DISTINCT FROM session_id
    AND (body_json::jsonb->>'sequence')::bigint IS NOT DISTINCT FROM sequence
    AND (body_json::jsonb->>'sourceSequence')::bigint IS NOT DISTINCT FROM source_sequence
    AND body_json::jsonb->>'assignmentDigest' IS NOT DISTINCT FROM assignment_digest
    AND body_json::jsonb->>'sourceSessionId' IS NOT DISTINCT FROM source_session_id
    AND body_json::jsonb->>'packetDigest' IS NOT DISTINCT FROM packet_digest
    AND body_json::jsonb->>'previousCompletionDigest' IS NOT DISTINCT FROM previous_completion_digest
    AND body_json::jsonb->'output'->'receipt'->>'id' IS NOT DISTINCT FROM receipt_id)
);
--> statement-breakpoint
CREATE FUNCTION trader_research_understanding_v1_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb := NEW.body_json::jsonb; assignment jsonb; profile jsonb; receipt jsonb; predecessor text; packet jsonb;
BEGIN
  IF TG_TABLE_NAME = 'trader_research_understanding_assignments_v1' THEN
    SELECT profile_json INTO profile FROM trader_required_information_profile_v2
      WHERE id=NEW.profile_id AND organization_id=NEW.organization_id AND content_digest=NEW.profile_content_digest;
    IF profile IS NULL OR profile->>'purpose' IS DISTINCT FROM 'RESEARCH_NON_CAPITAL'
      OR profile->>'authority' IS DISTINCT FROM 'EPISTEMIC_PREREQUISITE_ONLY'
      OR profile->>'profileVersion' !~ '^research-recorded-what/v1/[a-z0-9][a-z0-9._-]{0,63}$'
      OR profile->>'accountId' IS DISTINCT FROM body->>'accountId'
      OR profile->>'symbol' IS DISTINCT FROM body->>'symbol'
      OR body->'declarations'->>'predicate' IS DISTINCT FROM 'RESEARCH_INPUT_ADMITTED_V1'
      OR body->'declarations'->>'dependencyMap' IS DISTINCT FROM 'recorded-research-what-dependencies/v1'
      OR body->'declarations'->>'computation' IS DISTINCT FROM 'recorded-research-understanding-computation/v1'
    THEN RAISE EXCEPTION 'RESEARCH_ASSIGNMENT_LINK_CONFLICT'; END IF;
  ELSE
    SELECT body_json::jsonb INTO assignment FROM trader_research_understanding_assignments_v1
      WHERE organization_id=NEW.organization_id AND session_id=NEW.session_id AND content_digest=NEW.assignment_digest;
    SELECT receipt_json INTO receipt FROM trader_information_sufficiency_receipt_v2 WHERE id=NEW.receipt_id AND organization_id=NEW.organization_id;
    SELECT body_json::jsonb INTO packet FROM trader_recorded_analysis_packets_v1
      WHERE organization_id=NEW.organization_id AND session_id=NEW.source_session_id AND sequence=NEW.source_sequence AND content_digest=NEW.packet_digest;
    IF assignment IS NULL OR receipt IS NULL OR packet IS NULL
      OR NEW.source_sequence IS DISTINCT FROM (assignment->>'firstSourceSequence')::bigint + NEW.sequence
      OR NEW.source_session_id IS DISTINCT FROM assignment->>'sourceSessionId'
      OR body->'output'->>'assignmentDigest' IS DISTINCT FROM NEW.assignment_digest
      OR body->'output'->>'packetDigest' IS DISTINCT FROM NEW.packet_digest
      OR body->'output'->'declarations' IS DISTINCT FROM assignment->'declarations'
      OR body->'output'->'receipt' IS DISTINCT FROM receipt
      OR receipt->>'profileId' IS DISTINCT FROM assignment->>'profileId'
      OR receipt->>'profileContentDigest' IS DISTINCT FROM assignment->>'profileContentDigest'
      OR receipt->>'purpose' IS DISTINCT FROM 'RESEARCH_NON_CAPITAL'
      OR receipt->>'accountId' IS DISTINCT FROM assignment->>'accountId'
      OR body->'output'->>'analysisPitAnchor' IS DISTINCT FROM packet->>'analysisPitAnchor'
    THEN RAISE EXCEPTION 'RESEARCH_COMPLETION_LINK_CONFLICT'; END IF;
    IF NEW.sequence = 0 THEN
      IF NEW.previous_completion_digest IS NOT NULL THEN RAISE EXCEPTION 'RESEARCH_PREDECESSOR_CONFLICT'; END IF;
    ELSE
      SELECT content_digest INTO predecessor FROM trader_research_understanding_completions_v1
        WHERE organization_id=NEW.organization_id AND session_id=NEW.session_id AND sequence=NEW.sequence-1;
      IF NOT FOUND OR predecessor IS DISTINCT FROM NEW.previous_completion_digest THEN RAISE EXCEPTION 'RESEARCH_PREDECESSOR_CONFLICT'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trader_research_assignments_v1_links BEFORE INSERT ON trader_research_understanding_assignments_v1
  FOR EACH ROW EXECUTE FUNCTION trader_research_understanding_v1_links();
--> statement-breakpoint
CREATE TRIGGER trader_research_completions_v1_links BEFORE INSERT ON trader_research_understanding_completions_v1
  FOR EACH ROW EXECUTE FUNCTION trader_research_understanding_v1_links();
--> statement-breakpoint
CREATE TRIGGER trader_research_assignments_v1_immutable BEFORE UPDATE OR DELETE ON trader_research_understanding_assignments_v1
  FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE TRIGGER trader_research_completions_v1_immutable BEFORE UPDATE OR DELETE ON trader_research_understanding_completions_v1
  FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
-- Each sidecar owns a deferred current-holder fence; a saved packet FK does not provide it.
CREATE CONSTRAINT TRIGGER trader_research_assignments_v1_fence AFTER INSERT ON trader_research_understanding_assignments_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_research_completions_v1_fence AFTER INSERT ON trader_research_understanding_completions_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_research_understanding_assignments_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY research_assignments_browser_deny ON trader_research_understanding_assignments_v1
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE trader_research_understanding_completions_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY research_completions_browser_deny ON trader_research_understanding_completions_v1
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
