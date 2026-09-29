-- DEE-1145: durable versioned LiveCapitalEnvelopeV2. Amount columns have no default.
-- 0224 and every earlier migration stay unchanged. Heartbeat and boolean flags are not columns.
--> statement-breakpoint
CREATE TABLE public.trader_live_capital_envelopes_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK (octet_length(body_text) <= 16384
    AND jsonb_typeof(body_text::jsonb) = 'object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'live-capital-envelope/v2'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND body_text::jsonb->>'commandId' IS NOT DISTINCT FROM command_id::text
    AND body_text::jsonb->>'policyDigest' IS NOT DISTINCT FROM policy_digest
    AND body_text::jsonb->>'releaseSha' IS NOT DISTINCT FROM release_sha
    AND body_text::jsonb->>'capitalNotional' IS NOT DISTINCT FROM capital_notional
    AND body_text::jsonb->>'lossLimitNotional' IS NOT DISTINCT FROM loss_limit_notional
    AND (body_text::jsonb->>'validFromUtc')::timestamptz IS NOT DISTINCT FROM valid_from
    AND (body_text::jsonb->>'validUntilUtc')::timestamptz IS NOT DISTINCT FROM valid_until
    AND NOT (body_text::jsonb ? 'contentDigest')
    AND NOT (body_text::jsonb ? 'heartbeat')
    AND NOT (body_text::jsonb ? 'authorized')
    AND NOT (body_text::jsonb ? 'enabled')
    AND NOT (body_text::jsonb ? 'liveEnabled')
    AND content_digest = encode(sha256(convert_to(body_text, 'UTF8')), 'hex')),
  command_id uuid NOT NULL,
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{64}$'),
  capital_notional text NOT NULL CHECK (length(capital_notional) BETWEEN 1 AND 80),
  loss_limit_notional text NOT NULL CHECK (length(loss_limit_notional) BETWEEN 1 AND 80),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  PRIMARY KEY (organization_id, account_id, content_digest),
  UNIQUE (organization_id, account_id, command_id),
  CHECK (valid_until > valid_from)
);
--> statement-breakpoint
CREATE TABLE public.trader_live_capital_envelope_journal_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK (octet_length(body_text) <= 8192
    AND jsonb_typeof(body_text::jsonb) = 'object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'live-capital-envelope-journal/v2'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND body_text::jsonb->>'commandId' IS NOT DISTINCT FROM command_id::text
    AND body_text::jsonb->>'stage' IS NOT DISTINCT FROM stage
    AND body_text::jsonb->>'envelopeDigest' IS NOT DISTINCT FROM envelope_digest
    AND body_text::jsonb->>'basisDigest' IS NOT DISTINCT FROM basis_digest
    AND NOT (body_text::jsonb ? 'contentDigest')
    AND NOT (body_text::jsonb ? 'heartbeat')
    AND NOT (body_text::jsonb ? 'authorized')
    AND content_digest = encode(sha256(convert_to(body_text, 'UTF8')), 'hex')),
  command_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('CAPTURED', 'SEALED', 'ADMITTED', 'PUBLISHED', 'INVALIDATED')),
  envelope_digest text CHECK (envelope_digest IS NULL OR envelope_digest ~ '^[0-9a-f]{64}$'),
  basis_digest text CHECK (basis_digest IS NULL OR basis_digest ~ '^[0-9a-f]{64}$'),
  reason text,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  PRIMARY KEY (organization_id, account_id, content_digest),
  UNIQUE (organization_id, account_id, command_id, stage)
);
--> statement-breakpoint
CREATE TABLE public.trader_live_capital_basis_bindings_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  body_text text NOT NULL CHECK (octet_length(body_text) <= 8192
    AND jsonb_typeof(body_text::jsonb) = 'object'
    AND body_text::jsonb->>'schemaVersion' IS NOT DISTINCT FROM 'live-capital-basis-binding/v1'
    AND body_text::jsonb->>'organizationId' IS NOT DISTINCT FROM organization_id::text
    AND body_text::jsonb->>'accountId' IS NOT DISTINCT FROM account_id
    AND body_text::jsonb->>'envelopeDigest' IS NOT DISTINCT FROM envelope_digest
    AND body_text::jsonb->>'policyDigest' IS NOT DISTINCT FROM policy_digest
    AND body_text::jsonb->>'releaseSha' IS NOT DISTINCT FROM release_sha
    AND NOT (body_text::jsonb ? 'contentDigest')
    AND NOT (body_text::jsonb ? 'heartbeat')
    AND NOT (body_text::jsonb ? 'authorized')
    AND content_digest = encode(sha256(convert_to(body_text, 'UTF8')), 'hex')),
  envelope_digest text NOT NULL CHECK (envelope_digest ~ '^[0-9a-f]{64}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  PRIMARY KEY (organization_id, account_id, content_digest),
  UNIQUE (organization_id, account_id, envelope_digest),
  FOREIGN KEY (organization_id, account_id, envelope_digest)
    REFERENCES public.trader_live_capital_envelopes_v2 (organization_id, account_id, content_digest)
);
--> statement-breakpoint
CREATE TABLE public.trader_live_capital_envelope_current_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  account_id text NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
  command_id uuid NOT NULL,
  envelope_digest text NOT NULL CHECK (envelope_digest ~ '^[0-9a-f]{64}$'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^[0-9a-f]{64}$'),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{64}$'),
  basis_digest text CHECK (basis_digest IS NULL OR basis_digest ~ '^[0-9a-f]{64}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, account_id),
  UNIQUE (organization_id, account_id, command_id),
  FOREIGN KEY (organization_id, account_id, envelope_digest)
    REFERENCES public.trader_live_capital_envelopes_v2 (organization_id, account_id, content_digest),
  FOREIGN KEY (organization_id, account_id, basis_digest)
    REFERENCES public.trader_live_capital_basis_bindings_v2 (organization_id, account_id, content_digest)
);
--> statement-breakpoint
CREATE TRIGGER live_capital_envelope_no_mutation BEFORE UPDATE OR DELETE ON public.trader_live_capital_envelopes_v2
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER live_capital_envelope_no_mutation BEFORE UPDATE OR DELETE ON public.trader_live_capital_envelope_journal_v2
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
CREATE TRIGGER live_capital_envelope_no_mutation BEFORE UPDATE OR DELETE ON public.trader_live_capital_basis_bindings_v2
FOR EACH ROW EXECUTE FUNCTION public.waia_risk_current_account_v1_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_live_capital_envelopes_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_live_capital_envelopes_v2 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY live_capital_envelope_server_only ON public.trader_live_capital_envelopes_v2
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_live_capital_envelope_journal_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_live_capital_envelope_journal_v2 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY live_capital_envelope_server_only ON public.trader_live_capital_envelope_journal_v2
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_live_capital_basis_bindings_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_live_capital_basis_bindings_v2 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY live_capital_envelope_server_only ON public.trader_live_capital_basis_bindings_v2
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
--> statement-breakpoint
ALTER TABLE public.trader_live_capital_envelope_current_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trader_live_capital_envelope_current_v2 FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY live_capital_envelope_server_only ON public.trader_live_capital_envelope_current_v2
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
