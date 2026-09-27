-- DEE-1125: retain admitted period inputs; no economic allocation/finality authority.
CREATE TABLE trader_reporting_period_bases_v1 (
  reporting_period_id uuid PRIMARY KEY REFERENCES trader_reporting_periods(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  exchange_account_id text NOT NULL CHECK (length(btrim(exchange_account_id)) > 0),
  schema_version text NOT NULL CHECK (schema_version = 'waia.trader.reporting_period_basis.v1'),
  period_record_content_digest text NOT NULL CHECK (period_record_content_digest ~ '^[0-9a-f]{64}$'),
  receipt_content_digest text NOT NULL CHECK (receipt_content_digest ~ '^[0-9a-f]{64}$'),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  reality_projection_id text NOT NULL CHECK (reality_projection_id ~ '^[0-9a-f]{64}$'),
  reality_frontier_sequence bigint NOT NULL CHECK (reality_frontier_sequence > 0),
  reality_frontier_event_digest text NOT NULL CHECK (reality_frontier_event_digest ~ '^[0-9a-f]{64}$'),
  reality_knowledge_as_of timestamptz NOT NULL,
  canonical_json text NOT NULL CHECK (octet_length(canonical_json) <= 16777216),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT trader_reporting_period_bases_v1_body CHECK (
    jsonb_typeof(canonical_json::jsonb) = 'object'
    AND canonical_json::jsonb->>'schemaVersion' IS NOT DISTINCT FROM schema_version
    AND canonical_json::jsonb->>'capitalAuthority' IS NOT DISTINCT FROM 'NONE'
    AND canonical_json::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND canonical_json::jsonb->>'exchangeAccountId' IS NOT DISTINCT FROM exchange_account_id
    AND canonical_json::jsonb->>'reportingPeriodId' IS NOT DISTINCT FROM reporting_period_id::text
    AND canonical_json::jsonb->>'contentDigestHex' IS NOT DISTINCT FROM content_digest
    AND canonical_json::jsonb->'period'->>'recordContentDigest' IS NOT DISTINCT FROM period_record_content_digest
    AND canonical_json::jsonb->'period'->>'status' IS NOT DISTINCT FROM 'CLOSED'
    AND canonical_json::jsonb->'receipt'->>'contentDigestHex' IS NOT DISTINCT FROM receipt_content_digest
    AND canonical_json::jsonb->'dependencies'->'binding'->'projection'->>'projectionId' IS NOT DISTINCT FROM reality_projection_id
    AND canonical_json::jsonb->'dependencies'->'binding'->'projection'->>'frontierSequence' IS NOT DISTINCT FROM reality_frontier_sequence::text
    AND canonical_json::jsonb->'dependencies'->'binding'->'projection'->>'frontierEventDigestHex' IS NOT DISTINCT FROM reality_frontier_event_digest
    AND (canonical_json::jsonb->'dependencies'->'binding'->'projection'->>'knowledgeAsOfUtc')::timestamptz IS NOT DISTINCT FROM reality_knowledge_as_of
  )
);
--> statement-breakpoint
CREATE INDEX trader_reporting_period_bases_v1_scope ON trader_reporting_period_bases_v1(organization_id, exchange_account_id, reporting_period_id);
--> statement-breakpoint
CREATE FUNCTION trader_reporting_period_bases_v1_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM trader_reporting_periods p WHERE p.id = NEW.reporting_period_id
    AND p.organization_id = NEW.organization_id AND p.exchange_account_id = NEW.exchange_account_id
    AND p.status = 'CLOSED' AND p.record_content_digest = NEW.period_record_content_digest)
  THEN RAISE EXCEPTION 'REPORTING_PERIOD_BASIS_PERIOD_MISMATCH'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trader_reporting_period_bases_v1_insert_guard BEFORE INSERT ON trader_reporting_period_bases_v1
  FOR EACH ROW EXECUTE FUNCTION trader_reporting_period_bases_v1_insert_guard();
--> statement-breakpoint
CREATE FUNCTION trader_reporting_period_bases_v1_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REPORTING_PERIOD_BASIS_APPEND_ONLY'; END $$;
--> statement-breakpoint
CREATE TRIGGER trader_reporting_period_bases_v1_append_only BEFORE UPDATE OR DELETE ON trader_reporting_period_bases_v1
  FOR EACH ROW EXECUTE FUNCTION trader_reporting_period_bases_v1_append_only();
--> statement-breakpoint
ALTER TABLE trader_reporting_period_bases_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trader_reporting_period_bases_v1_browser_deny ON trader_reporting_period_bases_v1
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
--> statement-breakpoint
REVOKE ALL ON trader_reporting_period_bases_v1 FROM authenticated, anon;
