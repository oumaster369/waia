-- DEE-1121: exact normalized data and observational analysis, not qualified authority.
CREATE TABLE trader_recorded_analysis_sessions_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  session_id text NOT NULL CHECK (length(btrim(session_id)) > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.recorded_noncapital_analysis.v1'
    AND content_digest = encode(sha256(convert_to(body_json, 'UTF8')), 'hex')),
  runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch > 0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  PRIMARY KEY (organization_id, session_id),
  UNIQUE (organization_id, session_id, content_digest),
  CHECK (body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_json::jsonb->>'sessionId' IS NOT DISTINCT FROM session_id)
);
--> statement-breakpoint
CREATE TABLE trader_recorded_analysis_packets_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  session_id text NOT NULL CHECK (length(btrim(session_id)) > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.recorded_noncapital_analysis.v1'
    AND content_digest = encode(sha256(convert_to(body_json, 'UTF8')), 'hex')),
  runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch > 0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991),
  config_digest text NOT NULL,
  analysis_pit_anchor timestamptz NOT NULL,
  PRIMARY KEY (organization_id, session_id, sequence),
  UNIQUE (organization_id, session_id, sequence, content_digest),
  FOREIGN KEY (organization_id, session_id, config_digest)
    REFERENCES trader_recorded_analysis_sessions_v1(organization_id, session_id, content_digest),
  CHECK (body_json::jsonb->'session'->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_json::jsonb->'session'->>'sessionId' IS NOT DISTINCT FROM session_id
    AND body_json::jsonb->'session'->>'configDigest' IS NOT DISTINCT FROM config_digest
    AND (body_json::jsonb->>'sequence')::bigint IS NOT DISTINCT FROM sequence
    AND (body_json::jsonb->>'analysisPitAnchor')::timestamptz IS NOT DISTINCT FROM analysis_pit_anchor)
);
--> statement-breakpoint
CREATE TABLE trader_recorded_analysis_companions_v1 (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  session_id text NOT NULL CHECK (length(btrim(session_id)) > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_json text NOT NULL CHECK (jsonb_typeof(body_json::jsonb) = 'object'
    AND body_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'waia.trader.recorded_noncapital_analysis.v1'
    AND content_digest = encode(sha256(convert_to(body_json, 'UTF8')), 'hex')),
  runtime_instance_id text NOT NULL,
  lease_epoch integer NOT NULL CHECK (lease_epoch > 0),
  lease_content_digest text NOT NULL REFERENCES trader_runtime_control_lease_epoch_history_v2(content_digest),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991),
  packet_digest text NOT NULL,
  account_id text NOT NULL,
  symbol text NOT NULL,
  bar_interval text NOT NULL CHECK (bar_interval = '1m'),
  scheduled_bar_close_time timestamptz NOT NULL,
  PRIMARY KEY (organization_id, session_id, sequence),
  UNIQUE (organization_id, account_id, symbol, bar_interval, scheduled_bar_close_time),
  FOREIGN KEY (organization_id, session_id, sequence, packet_digest)
    REFERENCES trader_recorded_analysis_packets_v1(organization_id, session_id, sequence, content_digest),
  FOREIGN KEY (organization_id, account_id, symbol, bar_interval, scheduled_bar_close_time)
    REFERENCES trader_runtime_noncapital_cycles_v2(organization_id, account_id, symbol, bar_interval, pit_anchor),
  CHECK (body_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_json::jsonb->>'sessionId' IS NOT DISTINCT FROM session_id
    AND (body_json::jsonb->>'sequence')::bigint IS NOT DISTINCT FROM sequence
    AND body_json::jsonb->>'packetDigest' IS NOT DISTINCT FROM packet_digest
    AND body_json::jsonb->'output'->>'packetDigest' IS NOT DISTINCT FROM packet_digest
    AND body_json::jsonb->'output'->>'authority' IS NOT DISTINCT FROM 'OBSERVATIONAL_ONLY')
);
--> statement-breakpoint
-- Every new table has its own deferred fence; v2 reference alone is insufficient.
CREATE FUNCTION trader_recorded_analysis_v1_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner trader_runtime_control_lease_heads_v2%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 637));
  SELECT * INTO owner FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND OR owner.runtime_instance_id <> NEW.runtime_instance_id OR owner.lease_epoch <> NEW.lease_epoch
    OR owner.content_digest <> NEW.lease_content_digest OR clock_timestamp() > owner.valid_until_utc
  THEN RAISE EXCEPTION 'RUNTIME_CONTROL_LEASE_STALE_HOLDER'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trader_recorded_analysis_sessions_v1_immutable BEFORE UPDATE OR DELETE ON trader_recorded_analysis_sessions_v1
  FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_recorded_analysis_sessions_v1_fence AFTER INSERT ON trader_recorded_analysis_sessions_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_recorded_analysis_sessions_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sessions_browser_deny ON trader_recorded_analysis_sessions_v1 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE TRIGGER trader_recorded_analysis_packets_v1_immutable BEFORE UPDATE OR DELETE ON trader_recorded_analysis_packets_v1
  FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_recorded_analysis_packets_v1_fence AFTER INSERT ON trader_recorded_analysis_packets_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_recorded_analysis_packets_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY packets_browser_deny ON trader_recorded_analysis_packets_v1 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE TRIGGER trader_recorded_analysis_companions_v1_immutable BEFORE UPDATE OR DELETE ON trader_recorded_analysis_companions_v1
  FOR EACH ROW EXECUTE FUNCTION trader_runtime_authority_v2_append_only_guard();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_recorded_analysis_companions_v1_fence AFTER INSERT ON trader_recorded_analysis_companions_v1
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_fence();
--> statement-breakpoint
ALTER TABLE trader_recorded_analysis_companions_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY companions_browser_deny ON trader_recorded_analysis_companions_v1 FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
-- Exact saved links, prefix predecessor and projection checks supplement the body text hash.
CREATE FUNCTION trader_recorded_analysis_v1_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb := NEW.body_json::jsonb; packet jsonb; previous jsonb; receipt jsonb; item jsonb; header jsonb;
BEGIN
  IF TG_TABLE_NAME = 'trader_recorded_analysis_packets_v1' THEN
    SELECT body_json::jsonb INTO header FROM trader_recorded_analysis_sessions_v1
      WHERE organization_id=NEW.organization_id AND session_id=NEW.session_id AND content_digest=NEW.config_digest;
    IF NOT FOUND OR header IS DISTINCT FROM ((body->'session') - 'configDigest')
      OR jsonb_typeof(body->'sources') IS DISTINCT FROM 'array'
      OR jsonb_array_length(body->'sources') IS DISTINCT FROM jsonb_array_length(body->'normalized'->'observations')
    THEN RAISE EXCEPTION 'RECORDED_ANALYSIS_PACKET_LINK_CONFLICT'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(body->'sources') LOOP
      SELECT receipt_json INTO receipt FROM trader_mi_gateway_pit_receipt_v1
        WHERE organization_id=NEW.organization_id AND id=item->'receipt'->>'id';
      IF NOT FOUND OR receipt IS DISTINCT FROM item->'receipt'
      THEN RAISE EXCEPTION 'RECORDED_ANALYSIS_SOURCE_LINK_CONFLICT'; END IF;
    END LOOP;
    IF NEW.sequence = 0 THEN
      IF body->'previousCompletionDigest' IS DISTINCT FROM 'null'::jsonb
        OR body->'previousState' IS DISTINCT FROM '{"schemaVersion":"waia.trader.hypothesis_session_state.v1","sustainedCyclesByType":{},"peakConfidenceByType":{},"lastActiveHypothesisType":null}'::jsonb
      THEN RAISE EXCEPTION 'RECORDED_ANALYSIS_PREDECESSOR_CONFLICT'; END IF;
    ELSE
      SELECT body_json::jsonb || jsonb_build_object('contentDigest',content_digest) INTO previous
        FROM trader_recorded_analysis_companions_v1
        WHERE organization_id=NEW.organization_id AND session_id=NEW.session_id AND sequence=NEW.sequence-1;
      IF NOT FOUND OR body->>'previousCompletionDigest' IS DISTINCT FROM previous->>'contentDigest'
        OR body->'previousState' IS DISTINCT FROM previous->'output'->'nextState'
        OR body->>'previousStateDigest' IS DISTINCT FROM previous->'output'->>'nextStateDigest'
      THEN RAISE EXCEPTION 'RECORDED_ANALYSIS_PREDECESSOR_CONFLICT'; END IF;
    END IF;
  ELSE
    SELECT body_json::jsonb INTO packet FROM trader_recorded_analysis_packets_v1
      WHERE organization_id=NEW.organization_id AND session_id=NEW.session_id AND sequence=NEW.sequence AND content_digest=NEW.packet_digest;
    SELECT canonical_json::jsonb INTO receipt FROM trader_runtime_noncapital_cycles_v2
      WHERE organization_id=NEW.organization_id AND account_id=NEW.account_id AND symbol=NEW.symbol
        AND bar_interval=NEW.bar_interval AND pit_anchor=NEW.scheduled_bar_close_time;
    IF packet IS NULL OR receipt IS NULL OR body->>'canonicalReceiptDigest' IS DISTINCT FROM receipt->>'contentDigest'
      OR packet->'session'->>'accountId' IS DISTINCT FROM NEW.account_id
      OR packet->'session'->>'symbol' IS DISTINCT FROM NEW.symbol
      OR (packet->'normalized'->>'scheduledBarCloseTime')::timestamptz IS DISTINCT FROM NEW.scheduled_bar_close_time
      OR body->'previousCompletionDigest' IS DISTINCT FROM packet->'previousCompletionDigest'
      OR receipt->'input'->>'releaseSha' IS DISTINCT FROM packet->'session'->>'releaseSha'
      OR receipt->'input'->'bar' IS DISTINCT FROM (packet->'normalized'->'bars'->'1m'->-1)
    THEN RAISE EXCEPTION 'RECORDED_ANALYSIS_COMPANION_LINK_CONFLICT'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trader_recorded_analysis_packets_v1_links BEFORE INSERT ON trader_recorded_analysis_packets_v1
  FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_links();
--> statement-breakpoint
CREATE TRIGGER trader_recorded_analysis_companions_v1_links BEFORE INSERT ON trader_recorded_analysis_companions_v1
  FOR EACH ROW EXECUTE FUNCTION trader_recorded_analysis_v1_links();
