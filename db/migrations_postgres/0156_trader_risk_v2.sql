-- DEE-665 / R650-C and DEE-666 / R650-D: Risk V2 durable authority boundary.
-- Additive PostgreSQL only. This migration does not rewrite legacy Risk or order rows.

CREATE OR REPLACE FUNCTION public.waia_risk_v2_valid_instrument_exposures(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value) AS entry
      WHERE jsonb_typeof(entry) <> 'object'
        OR COALESCE(entry->>'instrumentIdentityDigestHex', '') !~ '^[0-9a-f]{64}$'
        OR COALESCE(entry->>'symbol', '') = ''
        OR CASE
          WHEN COALESCE(entry->>'baseQuantity', '') ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$'
            THEN (entry->>'baseQuantity')::numeric < 0
          ELSE true
        END
    )
    AND (
      SELECT count(*) = count(DISTINCT entry->>'instrumentIdentityDigestHex')
      FROM jsonb_array_elements(value) AS entry
    );
$$;
--> statement-breakpoint
CREATE TABLE public.trader_risk_account_state_v2 (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  market text NOT NULL,
  quote_asset text NOT NULL,
  posture text NOT NULL,
  kill_state text NOT NULL,
  reconciliation_status text NOT NULL,
  reality_snapshot_id text NOT NULL,
  reality_content_digest text NOT NULL,
  reconciliation_authority_digest text NOT NULL,
  reconciled_instrument_exposures jsonb NOT NULL,
  reconciled_exposure_notional numeric(38,8) NOT NULL,
  worst_case_pending_exposure_notional numeric(38,8) NOT NULL,
  outstanding_reservation_notional numeric(38,8) NOT NULL,
  exposure_limit_notional numeric(38,8) NOT NULL,
  next_admission_sequence bigint NOT NULL DEFAULT 1,
  next_enforcement_event_sequence bigint NOT NULL DEFAULT 1,
  last_enforcement_event_digest text,
  state_version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  PRIMARY KEY (organization_id, account_id),
  CONSTRAINT trader_risk_account_state_v2_spot_usdt
    CHECK (market = 'SPOT' AND quote_asset = 'USDT'),
  CONSTRAINT trader_risk_account_state_v2_posture
    CHECK (posture IN ('NORMAL', 'CLOSE_ONLY', 'HALT', 'KILLED')),
  CONSTRAINT trader_risk_account_state_v2_kill
    CHECK (kill_state IN ('CLEAR', 'TRIPPED', 'UNKNOWN')),
  CONSTRAINT trader_risk_account_state_v2_reconciliation
    CHECK (reconciliation_status IN ('RECONCILED', 'DIVERGENT', 'UNAVAILABLE', 'STALE')),
  CONSTRAINT trader_risk_account_state_v2_digests CHECK (
    reality_content_digest ~ '^[0-9a-f]{64}$'
    AND reconciliation_authority_digest ~ '^[0-9a-f]{64}$'
    AND (last_enforcement_event_digest IS NULL
      OR last_enforcement_event_digest ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT trader_risk_account_state_v2_instrument_exposures CHECK (
    public.waia_risk_v2_valid_instrument_exposures(reconciled_instrument_exposures)
  ),
  CONSTRAINT trader_risk_account_state_v2_nonnegative CHECK (
    reconciled_exposure_notional >= 0
    AND worst_case_pending_exposure_notional >= 0
    AND outstanding_reservation_notional >= 0
    AND exposure_limit_notional >= 0
    AND next_admission_sequence > 0
    AND next_enforcement_event_sequence > 0
    AND state_version > 0
  ),
  CONSTRAINT trader_risk_account_state_v2_event_head_complete CHECK (
    (next_enforcement_event_sequence = 1 AND last_enforcement_event_digest IS NULL)
    OR (next_enforcement_event_sequence > 1 AND last_enforcement_event_digest IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX trader_risk_account_state_v2_org_posture_idx
  ON public.trader_risk_account_state_v2 (organization_id, posture);
--> statement-breakpoint
CREATE TABLE public.trader_risk_verdicts_v2 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  admission_sequence bigint NOT NULL,
  venue text NOT NULL,
  market text NOT NULL,
  symbol text NOT NULL,
  base_asset text NOT NULL,
  quote_asset text NOT NULL,
  instrument_identity_digest text NOT NULL,
  decision_id text NOT NULL,
  decision_semantic_digest text NOT NULL,
  decision_content_digest text NOT NULL,
  decision_action text NOT NULL,
  economic_size_set_id text NOT NULL,
  economic_size_set_digest text NOT NULL,
  risk_policy_version text NOT NULL,
  risk_policy_digest text NOT NULL,
  limit_versions jsonb NOT NULL,
  reality_snapshot_id text NOT NULL,
  reality_content_digest text NOT NULL,
  reality_as_of timestamptz NOT NULL,
  reconciliation_authority_digest text NOT NULL,
  reference_price_authority_id text NOT NULL,
  reference_price_authority_version text NOT NULL,
  reference_price_content_digest text NOT NULL,
  reference_price numeric(38,8) NOT NULL,
  verdict text NOT NULL,
  approved_qualified_quantity numeric(38,8),
  binding_layers jsonb NOT NULL,
  reason_codes jsonb NOT NULL,
  issued_at timestamptz NOT NULL,
  semantic_digest text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_risk_verdicts_v2_id_org_account_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_risk_verdicts_v2_spot_usdt CHECK (
    market = 'SPOT' AND quote_asset = 'USDT' AND symbol = base_asset || quote_asset
  ),
  CONSTRAINT trader_risk_verdicts_v2_action CHECK (
    decision_action IN ('ENTER_LONG', 'HOLD', 'REDUCE', 'CLOSE')
  ),
  CONSTRAINT trader_risk_verdicts_v2_verdict CHECK (
    verdict IN ('APPROVE', 'APPROVE_CLAMPED', 'VETO', 'CLOSE_ONLY', 'HALT')
  ),
  CONSTRAINT trader_risk_verdicts_v2_quantity CHECK (
    (verdict IN ('APPROVE', 'APPROVE_CLAMPED', 'CLOSE_ONLY')
      AND approved_qualified_quantity > 0
      AND decision_action <> 'HOLD'
      AND (verdict <> 'CLOSE_ONLY' OR decision_action IN ('REDUCE', 'CLOSE')))
    OR (verdict IN ('VETO', 'HALT') AND approved_qualified_quantity IS NULL)
  ),
  CONSTRAINT trader_risk_verdicts_v2_identity CHECK (
    admission_sequence > 0 AND schema_version = 'risk-verdict/v2'
  ),
  CONSTRAINT trader_risk_verdicts_v2_digests CHECK (
    instrument_identity_digest ~ '^[0-9a-f]{64}$'
    AND decision_semantic_digest ~ '^[0-9a-f]{64}$'
    AND decision_content_digest ~ '^[0-9a-f]{64}$'
    AND economic_size_set_digest ~ '^[0-9a-f]{64}$'
    AND risk_policy_digest ~ '^[0-9a-f]{64}$'
    AND reality_content_digest ~ '^[0-9a-f]{64}$'
    AND reconciliation_authority_digest ~ '^[0-9a-f]{64}$'
    AND reference_price_content_digest ~ '^[0-9a-f]{64}$'
    AND semantic_digest ~ '^[0-9a-f]{64}$'
    AND content_digest ~ '^[0-9a-f]{64}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_risk_verdicts_v2_org_account_sequence_unique
  ON public.trader_risk_verdicts_v2 (organization_id, account_id, admission_sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_risk_verdicts_v2_org_account_decision_unique
  ON public.trader_risk_verdicts_v2 (organization_id, account_id, decision_content_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_risk_verdicts_v2_org_content_digest_unique
  ON public.trader_risk_verdicts_v2 (organization_id, content_digest);
--> statement-breakpoint
CREATE INDEX trader_risk_verdicts_v2_org_account_issued_idx
  ON public.trader_risk_verdicts_v2 (organization_id, account_id, issued_at);
--> statement-breakpoint
CREATE TABLE public.trader_risk_allowances_v2 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  risk_verdict_id uuid NOT NULL,
  risk_verdict_content_digest text NOT NULL,
  admission_sequence bigint NOT NULL,
  nonce uuid NOT NULL,
  venue text NOT NULL,
  market text NOT NULL,
  symbol text NOT NULL,
  base_asset text NOT NULL,
  quote_asset text NOT NULL,
  instrument_identity_digest text NOT NULL,
  decision_id text NOT NULL,
  decision_semantic_digest text NOT NULL,
  decision_content_digest text NOT NULL,
  decision_action text NOT NULL,
  economic_size_set_id text NOT NULL,
  economic_size_set_digest text NOT NULL,
  risk_policy_version text NOT NULL,
  risk_policy_digest text NOT NULL,
  reality_snapshot_id text NOT NULL,
  reality_content_digest text NOT NULL,
  reconciliation_authority_digest text NOT NULL,
  posture_at_issuance text NOT NULL,
  strict_exposure_reduction boolean NOT NULL,
  exact_qualified_quantity numeric(38,8) NOT NULL,
  reserved_exposure_notional numeric(38,8) NOT NULL,
  lifecycle_state text NOT NULL,
  bound_order_id uuid,
  bound_order_digest text,
  issued_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  terminal_reason_code text,
  last_enforcement_event_sequence bigint NOT NULL,
  last_enforcement_event_digest text NOT NULL,
  semantic_digest text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_risk_allowances_v2_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT trader_risk_allowances_v2_id_org_account_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_risk_allowances_v2_verdict_scope_fk FOREIGN KEY (
    risk_verdict_id, organization_id, account_id
  ) REFERENCES public.trader_risk_verdicts_v2(id, organization_id, account_id),
  CONSTRAINT trader_risk_allowances_v2_spot_usdt CHECK (
    market = 'SPOT' AND quote_asset = 'USDT' AND symbol = base_asset || quote_asset
  ),
  CONSTRAINT trader_risk_allowances_v2_action CHECK (
    decision_action IN ('ENTER_LONG', 'HOLD', 'REDUCE', 'CLOSE')
  ),
  CONSTRAINT trader_risk_allowances_v2_posture CHECK (
    posture_at_issuance IN ('NORMAL', 'CLOSE_ONLY')
    AND (posture_at_issuance <> 'CLOSE_ONLY' OR strict_exposure_reduction)
    AND (
      (decision_action = 'ENTER_LONG' AND NOT strict_exposure_reduction)
      OR (decision_action IN ('REDUCE', 'CLOSE') AND strict_exposure_reduction)
    )
  ),
  CONSTRAINT trader_risk_allowances_v2_lifecycle CHECK (
    lifecycle_state IN ('ISSUED', 'CONSUMED', 'REVOKED', 'EXPIRED')
  ),
  CONSTRAINT trader_risk_allowances_v2_values CHECK (
    admission_sequence > 0
    AND exact_qualified_quantity > 0
    AND reserved_exposure_notional >= 0
    AND valid_until > issued_at
    AND last_enforcement_event_sequence > 0
    AND schema_version = 'risk-allowance/v2'
  ),
  CONSTRAINT trader_risk_allowances_v2_terminal_shape CHECK (
    (lifecycle_state = 'ISSUED' AND bound_order_id IS NULL AND bound_order_digest IS NULL
      AND consumed_at IS NULL AND revoked_at IS NULL AND expired_at IS NULL)
    OR (lifecycle_state = 'CONSUMED' AND bound_order_id IS NOT NULL
      AND bound_order_digest IS NOT NULL AND consumed_at IS NOT NULL
      AND revoked_at IS NULL AND expired_at IS NULL)
    OR (lifecycle_state = 'REVOKED' AND bound_order_id IS NULL AND bound_order_digest IS NULL
      AND consumed_at IS NULL AND revoked_at IS NOT NULL AND expired_at IS NULL)
    OR (lifecycle_state = 'EXPIRED' AND bound_order_id IS NULL AND bound_order_digest IS NULL
      AND consumed_at IS NULL AND revoked_at IS NULL AND expired_at IS NOT NULL)
  ),
  CONSTRAINT trader_risk_allowances_v2_digests CHECK (
    instrument_identity_digest ~ '^[0-9a-f]{64}$'
    AND decision_semantic_digest ~ '^[0-9a-f]{64}$'
    AND decision_content_digest ~ '^[0-9a-f]{64}$'
    AND economic_size_set_digest ~ '^[0-9a-f]{64}$'
    AND risk_policy_digest ~ '^[0-9a-f]{64}$'
    AND reality_content_digest ~ '^[0-9a-f]{64}$'
    AND reconciliation_authority_digest ~ '^[0-9a-f]{64}$'
    AND risk_verdict_content_digest ~ '^[0-9a-f]{64}$'
    AND (bound_order_digest IS NULL OR bound_order_digest ~ '^[0-9a-f]{64}$')
    AND last_enforcement_event_digest ~ '^[0-9a-f]{64}$'
    AND semantic_digest ~ '^[0-9a-f]{64}$'
    AND content_digest ~ '^[0-9a-f]{64}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_risk_allowances_v2_org_verdict_unique
  ON public.trader_risk_allowances_v2 (organization_id, risk_verdict_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_risk_allowances_v2_org_account_nonce_unique
  ON public.trader_risk_allowances_v2 (organization_id, account_id, nonce);
--> statement-breakpoint
CREATE INDEX trader_risk_allowances_v2_org_account_state_expiry_idx
  ON public.trader_risk_allowances_v2 (
    organization_id, account_id, lifecycle_state, valid_until
  );
--> statement-breakpoint
CREATE TABLE public.trader_risk_enforcement_events_v2 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  event_sequence bigint NOT NULL,
  risk_verdict_id uuid,
  risk_allowance_id uuid,
  event_type text NOT NULL,
  from_state text,
  to_state text,
  reason_code text,
  bound_order_id uuid,
  bound_order_digest text,
  event_payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  previous_event_digest text,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_risk_enforcement_events_v2_allowance_scope_fk FOREIGN KEY (
    risk_allowance_id, organization_id, account_id
  ) REFERENCES public.trader_risk_allowances_v2(id, organization_id, account_id),
  CONSTRAINT trader_risk_enforcement_events_v2_sequence CHECK (event_sequence > 0),
  CONSTRAINT trader_risk_enforcement_events_v2_type CHECK (
    event_type IN (
      'ALLOWANCE_ISSUED', 'ALLOWANCE_CONSUMED', 'ALLOWANCE_REVOKED',
      'ALLOWANCE_EXPIRED', 'CONSUMPTION_REFUSED'
    )
  ),
  CONSTRAINT trader_risk_enforcement_events_v2_states CHECK (
    (from_state IS NULL OR from_state IN ('ISSUED', 'CONSUMED', 'REVOKED', 'EXPIRED'))
    AND (to_state IS NULL OR to_state IN ('ISSUED', 'CONSUMED', 'REVOKED', 'EXPIRED'))
  ),
  CONSTRAINT trader_risk_enforcement_events_v2_order_binding CHECK (
    (bound_order_id IS NULL AND bound_order_digest IS NULL)
    OR (bound_order_id IS NOT NULL AND bound_order_digest IS NOT NULL)
  ),
  CONSTRAINT trader_risk_enforcement_events_v2_identity CHECK (
    schema_version = 'risk-enforcement-event/v2'
    AND content_digest ~ '^[0-9a-f]{64}$'
    AND (previous_event_digest IS NULL OR previous_event_digest ~ '^[0-9a-f]{64}$')
    AND (bound_order_digest IS NULL OR bound_order_digest ~ '^[0-9a-f]{64}$')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_risk_enforcement_events_v2_org_account_sequence_unique
  ON public.trader_risk_enforcement_events_v2 (organization_id, account_id, event_sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_risk_enforcement_events_v2_org_digest_unique
  ON public.trader_risk_enforcement_events_v2 (organization_id, content_digest);
--> statement-breakpoint
CREATE INDEX trader_risk_enforcement_events_v2_org_allowance_idx
  ON public.trader_risk_enforcement_events_v2 (
    organization_id, risk_allowance_id, event_sequence
  );
--> statement-breakpoint
ALTER TABLE public.trader_orders
  ADD COLUMN risk_allowance_id uuid,
  ADD COLUMN risk_allowance_binding_digest text;
--> statement-breakpoint
ALTER TABLE public.trader_orders
  ADD CONSTRAINT trader_orders_risk_allowance_binding_complete CHECK (
    (risk_allowance_id IS NULL AND risk_allowance_binding_digest IS NULL)
    OR (risk_allowance_id IS NOT NULL AND risk_allowance_binding_digest IS NOT NULL)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX trader_orders_org_risk_allowance_unique
  ON public.trader_orders (organization_id, risk_allowance_id)
  WHERE risk_allowance_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.trader_orders
  ADD CONSTRAINT trader_orders_risk_allowance_scope_fk
  FOREIGN KEY (risk_allowance_id, organization_id)
  REFERENCES public.trader_risk_allowances_v2(id, organization_id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE public.trader_risk_allowances_v2
  ADD CONSTRAINT trader_risk_allowances_v2_bound_order_scope_fk
  FOREIGN KEY (bound_order_id, organization_id)
  REFERENCES public.trader_orders(id, organization_id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_block_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_validate_verdict()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  normalized_layers jsonb;
  normalized_reasons jsonb;
BEGIN
  IF jsonb_typeof(NEW.binding_layers) <> 'array'
    OR jsonb_typeof(NEW.reason_codes) <> 'array'
  THEN
    RAISE EXCEPTION 'Risk V2 layers/reasons must be arrays' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(jsonb_agg(layer ORDER BY ordinal), '[]'::jsonb)
    INTO normalized_layers
  FROM (
    SELECT DISTINCT value AS layer,
      CASE value WHEN 'L0' THEN 0 WHEN 'L1' THEN 1 WHEN 'L2' THEN 2
        WHEN 'L3' THEN 3 WHEN 'L4' THEN 4 WHEN 'L5' THEN 5 WHEN 'L6' THEN 6 END AS ordinal
    FROM jsonb_array_elements_text(NEW.binding_layers) entry(value)
    WHERE value IN ('L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6')
  ) canonical;
  SELECT COALESCE(jsonb_agg(reason ORDER BY reason), '[]'::jsonb)
    INTO normalized_reasons
  FROM (
    SELECT DISTINCT value AS reason
    FROM jsonb_array_elements_text(NEW.reason_codes) entry(value)
    WHERE value ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ) canonical;
  IF normalized_layers IS DISTINCT FROM NEW.binding_layers
    OR jsonb_array_length(normalized_layers) = 0
    OR normalized_reasons IS DISTINCT FROM NEW.reason_codes
    OR (NEW.verdict <> 'APPROVE' AND jsonb_array_length(normalized_reasons) = 0)
  THEN
    RAISE EXCEPTION 'Risk V2 layers/reasons must be canonical, unique, sorted values'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_risk_verdicts_v2_validate_insert
  BEFORE INSERT ON public.trader_risk_verdicts_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_validate_verdict();
--> statement-breakpoint
CREATE TRIGGER trader_risk_verdicts_v2_block_update
  BEFORE UPDATE ON public.trader_risk_verdicts_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_risk_verdicts_v2_block_delete
  BEFORE DELETE ON public.trader_risk_verdicts_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_conservative_notional(
  exact_quantity numeric,
  conservative_reference_price numeric
)
RETURNS numeric LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT ceil(exact_quantity * conservative_reference_price * 100000000::numeric)
    / 100000000::numeric
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_validate_allowance_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  verdict_row public.trader_risk_verdicts_v2%ROWTYPE;
BEGIN
  SELECT * INTO verdict_row
  FROM public.trader_risk_verdicts_v2
  WHERE id = NEW.risk_verdict_id
    AND organization_id = NEW.organization_id
    AND account_id = NEW.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Risk allowance verdict authority is missing'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF verdict_row.content_digest <> NEW.risk_verdict_content_digest
    OR verdict_row.admission_sequence <> NEW.admission_sequence
    OR verdict_row.venue <> NEW.venue
    OR verdict_row.market <> NEW.market
    OR verdict_row.symbol <> NEW.symbol
    OR verdict_row.base_asset <> NEW.base_asset
    OR verdict_row.quote_asset <> NEW.quote_asset
    OR verdict_row.instrument_identity_digest <> NEW.instrument_identity_digest
    OR verdict_row.decision_id <> NEW.decision_id
    OR verdict_row.decision_semantic_digest <> NEW.decision_semantic_digest
    OR verdict_row.decision_content_digest <> NEW.decision_content_digest
    OR verdict_row.decision_action <> NEW.decision_action
    OR verdict_row.economic_size_set_id <> NEW.economic_size_set_id
    OR verdict_row.economic_size_set_digest <> NEW.economic_size_set_digest
    OR verdict_row.risk_policy_version <> NEW.risk_policy_version
    OR verdict_row.risk_policy_digest <> NEW.risk_policy_digest
    OR verdict_row.reality_snapshot_id <> NEW.reality_snapshot_id
    OR verdict_row.reality_content_digest <> NEW.reality_content_digest
    OR verdict_row.reconciliation_authority_digest <> NEW.reconciliation_authority_digest
    OR verdict_row.approved_qualified_quantity IS DISTINCT FROM NEW.exact_qualified_quantity
    OR verdict_row.verdict NOT IN ('APPROVE', 'APPROVE_CLAMPED', 'CLOSE_ONLY')
    OR (
      NEW.decision_action = 'ENTER_LONG'
      AND NEW.reserved_exposure_notional IS DISTINCT FROM
        public.waia_risk_v2_conservative_notional(
          NEW.exact_qualified_quantity,
          verdict_row.reference_price
        )
    )
    OR (
      NEW.decision_action IN ('REDUCE', 'CLOSE')
      AND NEW.reserved_exposure_notional <> 0
    )
  THEN
    RAISE EXCEPTION 'Risk allowance does not exactly match its sealed verdict authority'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_risk_allowances_v2_validate_insert
  BEFORE INSERT ON public.trader_risk_allowances_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_validate_allowance_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_guard_allowance_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.organization_id, NEW.account_id, NEW.risk_verdict_id,
    NEW.risk_verdict_content_digest,
    NEW.admission_sequence, NEW.nonce, NEW.venue, NEW.market, NEW.symbol,
    NEW.base_asset, NEW.quote_asset, NEW.instrument_identity_digest,
    NEW.decision_id, NEW.decision_semantic_digest, NEW.decision_content_digest,
    NEW.decision_action, NEW.economic_size_set_id, NEW.economic_size_set_digest,
    NEW.risk_policy_version, NEW.risk_policy_digest, NEW.reality_snapshot_id,
    NEW.reality_content_digest, NEW.reconciliation_authority_digest,
    NEW.posture_at_issuance, NEW.strict_exposure_reduction,
    NEW.exact_qualified_quantity, NEW.reserved_exposure_notional,
    NEW.issued_at, NEW.valid_until, NEW.semantic_digest, NEW.content_digest,
    NEW.schema_version, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.account_id, OLD.risk_verdict_id,
    OLD.risk_verdict_content_digest,
    OLD.admission_sequence, OLD.nonce, OLD.venue, OLD.market, OLD.symbol,
    OLD.base_asset, OLD.quote_asset, OLD.instrument_identity_digest,
    OLD.decision_id, OLD.decision_semantic_digest, OLD.decision_content_digest,
    OLD.decision_action, OLD.economic_size_set_id, OLD.economic_size_set_digest,
    OLD.risk_policy_version, OLD.risk_policy_digest, OLD.reality_snapshot_id,
    OLD.reality_content_digest, OLD.reconciliation_authority_digest,
    OLD.posture_at_issuance, OLD.strict_exposure_reduction,
    OLD.exact_qualified_quantity, OLD.reserved_exposure_notional,
    OLD.issued_at, OLD.valid_until, OLD.semantic_digest, OLD.content_digest,
    OLD.schema_version, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Risk allowance immutable authority fields cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.lifecycle_state <> 'ISSUED'
    OR NEW.lifecycle_state NOT IN ('CONSUMED', 'REVOKED', 'EXPIRED')
  THEN
    RAISE EXCEPTION 'Risk allowance lifecycle transition is terminal or invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.last_enforcement_event_sequence <= OLD.last_enforcement_event_sequence
    OR NEW.last_enforcement_event_digest = OLD.last_enforcement_event_digest
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'Risk allowance transition requires a later enforcement event'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_risk_allowances_v2_guard_update
  BEFORE UPDATE ON public.trader_risk_allowances_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_guard_allowance_transition();
--> statement-breakpoint
CREATE TRIGGER trader_risk_allowances_v2_block_delete
  BEFORE DELETE ON public.trader_risk_allowances_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_guard_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  account_state public.trader_risk_account_state_v2%ROWTYPE;
BEGIN
  SELECT * INTO account_state
  FROM public.trader_risk_account_state_v2
  WHERE organization_id = NEW.organization_id AND account_id = NEW.account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Risk account state is missing' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.event_sequence <> account_state.next_enforcement_event_sequence
    OR NEW.previous_event_digest IS DISTINCT FROM account_state.last_enforcement_event_digest
  THEN
    RAISE EXCEPTION 'Risk enforcement event sequence/digest head mismatch'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_risk_enforcement_events_v2_guard_insert
  BEFORE INSERT ON public.trader_risk_enforcement_events_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_guard_event_insert();
--> statement-breakpoint
CREATE TRIGGER trader_risk_enforcement_events_v2_block_update
  BEFORE UPDATE ON public.trader_risk_enforcement_events_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_risk_enforcement_events_v2_block_delete
  BEFORE DELETE ON public.trader_risk_enforcement_events_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_verify_account_event_head()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.next_enforcement_event_sequence = 1 THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trader_risk_enforcement_events_v2 e
    WHERE e.organization_id = NEW.organization_id
      AND e.account_id = NEW.account_id
      AND e.event_sequence = NEW.next_enforcement_event_sequence - 1
      AND e.content_digest = NEW.last_enforcement_event_digest
  ) THEN
    RAISE EXCEPTION 'Risk account event head is not backed by the append-only ledger'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_risk_account_state_v2_verify_event_head
  AFTER INSERT OR UPDATE ON public.trader_risk_account_state_v2
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_verify_account_event_head();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_verify_reservation_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  durable_total numeric(38,8);
BEGIN
  SELECT COALESCE(sum(reserved_exposure_notional), 0::numeric)
    INTO durable_total
  FROM public.trader_risk_allowances_v2
  WHERE organization_id = NEW.organization_id
    AND account_id = NEW.account_id
    AND lifecycle_state = 'ISSUED';
  IF durable_total IS DISTINCT FROM NEW.outstanding_reservation_notional THEN
    RAISE EXCEPTION 'Risk outstanding reservation projection does not match issued allowances'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_risk_account_state_v2_verify_reservations
  AFTER INSERT OR UPDATE ON public.trader_risk_account_state_v2
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_verify_reservation_projection();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_risk_v2_verify_allowance_event_head()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.trader_risk_enforcement_events_v2 e
    WHERE e.organization_id = NEW.organization_id
      AND e.account_id = NEW.account_id
      AND e.risk_allowance_id = NEW.id
      AND e.event_sequence = NEW.last_enforcement_event_sequence
      AND e.content_digest = NEW.last_enforcement_event_digest
      AND e.to_state = NEW.lifecycle_state
  ) THEN
    RAISE EXCEPTION 'Risk allowance projection is not backed by its enforcement event head'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_risk_allowances_v2_verify_event_head
  AFTER INSERT OR UPDATE ON public.trader_risk_allowances_v2
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.waia_risk_v2_verify_allowance_event_head();
--> statement-breakpoint
ALTER TABLE public.trader_risk_account_state_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_risk_verdicts_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_risk_allowances_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_risk_enforcement_events_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trader_risk_account_state_v2_deny_client_all
  ON public.trader_risk_account_state_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_risk_verdicts_v2_deny_client_all
  ON public.trader_risk_verdicts_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_risk_allowances_v2_deny_client_all
  ON public.trader_risk_allowances_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_risk_enforcement_events_v2_deny_client_all
  ON public.trader_risk_enforcement_events_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_risk_account_state_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_risk_verdicts_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_risk_allowances_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_risk_enforcement_events_v2 FROM authenticated, anon;
