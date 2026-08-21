-- DEE-667 / E651-A: Execution V2 contracts and durable authority substrate.
-- Additive PostgreSQL only. No Risk V2, Treasury, or legacy order history is rewritten.

ALTER TABLE public.trader_orders
  ADD COLUMN execution_plan_id uuid,
  ADD COLUMN execution_plan_digest text,
  ADD COLUMN execution_attempt_id uuid,
  ADD COLUMN execution_attempt_digest text;
--> statement-breakpoint
ALTER TABLE public.trader_orders
  ADD CONSTRAINT trader_orders_execution_v2_binding_complete CHECK (
    (execution_plan_id IS NULL AND execution_plan_digest IS NULL
      AND execution_attempt_id IS NULL AND execution_attempt_digest IS NULL)
    OR (execution_plan_id IS NOT NULL AND execution_plan_digest IS NOT NULL
      AND execution_attempt_id IS NOT NULL AND execution_attempt_digest IS NOT NULL)
  ),
  ADD CONSTRAINT trader_orders_execution_v2_digests CHECK (
    (execution_plan_digest IS NULL OR execution_plan_digest ~ '^[0-9a-f]{64}$')
    AND (execution_attempt_digest IS NULL OR execution_attempt_digest ~ '^[0-9a-f]{64}$')
  );
--> statement-breakpoint
CREATE TABLE public.trader_execution_policies_v2 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  decision_id text NOT NULL,
  decision_content_digest text NOT NULL,
  decision_execution_policy_digest text NOT NULL,
  economic_size_set_digest text NOT NULL,
  venue text NOT NULL,
  market text NOT NULL,
  instrument_identity_digest text NOT NULL,
  allowed_order_types jsonb NOT NULL,
  allowed_time_in_force jsonb NOT NULL,
  allowed_liquidity_roles jsonb NOT NULL,
  price_collar jsonb NOT NULL,
  quantity_rules jsonb NOT NULL,
  slicing_policy jsonb NOT NULL,
  retry_policy jsonb NOT NULL,
  cancel_policy jsonb NOT NULL,
  timeout_ms integer NOT NULL,
  uncertainty_handling text NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz NOT NULL,
  semantic_digest text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_execution_policies_v2_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT trader_execution_policies_v2_identity CHECK (
    market = 'SPOT'
    AND schema_version = 'execution-policy-binding/v2'
    AND timeout_ms > 0
    AND effective_until > effective_from
    AND uncertainty_handling = 'RECONCILIATION_REQUIRED'
  ),
  CONSTRAINT trader_execution_policies_v2_digests CHECK (
    decision_content_digest ~ '^[0-9a-f]{64}$'
    AND decision_execution_policy_digest ~ '^[0-9a-f]{64}$'
    AND economic_size_set_digest ~ '^[0-9a-f]{64}$'
    AND instrument_identity_digest ~ '^[0-9a-f]{64}$'
    AND semantic_digest ~ '^[0-9a-f]{64}$'
    AND content_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_execution_policies_v2_arrays CHECK (
    jsonb_typeof(allowed_order_types) = 'array'
    AND jsonb_array_length(allowed_order_types) > 0
    AND jsonb_typeof(allowed_time_in_force) = 'array'
    AND jsonb_array_length(allowed_time_in_force) > 0
    AND jsonb_typeof(allowed_liquidity_roles) = 'array'
    AND jsonb_array_length(allowed_liquidity_roles) > 0
  ),
  CONSTRAINT trader_execution_policies_v2_json CHECK (
    jsonb_typeof(price_collar) = 'object'
    AND jsonb_typeof(quantity_rules) = 'object'
    AND jsonb_typeof(slicing_policy) = 'object'
    AND jsonb_typeof(retry_policy) = 'object'
    AND jsonb_typeof(cancel_policy) = 'object'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_policies_v2_org_content_unique
  ON public.trader_execution_policies_v2 (organization_id, content_digest);
--> statement-breakpoint
CREATE INDEX trader_execution_policies_v2_org_venue_instrument_idx
  ON public.trader_execution_policies_v2 (organization_id, venue, instrument_identity_digest);
--> statement-breakpoint
CREATE TABLE public.trader_execution_plans_v2 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  risk_allowance_id uuid NOT NULL,
  risk_allowance_content_digest text NOT NULL,
  risk_verdict_id uuid NOT NULL,
  decision_id text NOT NULL,
  decision_content_digest text NOT NULL,
  economic_size_set_digest text NOT NULL,
  instrument_identity_digest text NOT NULL,
  symbol text NOT NULL,
  action text NOT NULL,
  side text NOT NULL,
  approved_qualified_quantity_ceiling numeric(38,8) NOT NULL,
  approved_notional_ceiling numeric(38,8) NOT NULL,
  planned_quantity numeric(38,8) NOT NULL,
  venue text NOT NULL,
  order_type text NOT NULL,
  liquidity_role text NOT NULL,
  limit_price numeric(38,8),
  price_collar jsonb NOT NULL,
  time_in_force text NOT NULL,
  timing_window jsonb NOT NULL,
  quantity_rules jsonb NOT NULL,
  child_slices jsonb NOT NULL,
  retry_policy jsonb NOT NULL,
  cancel_policy jsonb NOT NULL,
  execution_policy_id uuid NOT NULL,
  execution_policy_content_digest text NOT NULL,
  sealed_at timestamptz NOT NULL,
  semantic_digest text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_execution_plans_v2_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT trader_execution_plans_v2_id_org_account_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_execution_plans_v2_allowance_scope_fk FOREIGN KEY (
    risk_allowance_id, organization_id, account_id
  ) REFERENCES public.trader_risk_allowances_v2(id, organization_id, account_id),
  CONSTRAINT trader_execution_plans_v2_policy_scope_fk FOREIGN KEY (
    execution_policy_id, organization_id
  ) REFERENCES public.trader_execution_policies_v2(id, organization_id),
  CONSTRAINT trader_execution_plans_v2_identity CHECK (
    schema_version = 'execution-plan/v2'
    AND action IN ('ENTER_LONG', 'REDUCE', 'CLOSE')
    AND side IN ('buy', 'sell')
    AND order_type IN ('market', 'limit')
    AND liquidity_role IN ('MAKER', 'TAKER')
    AND time_in_force IN ('GTC', 'IOC', 'FOK')
    AND approved_qualified_quantity_ceiling > 0
    AND approved_notional_ceiling >= 0
    AND planned_quantity > 0
    AND planned_quantity <= approved_qualified_quantity_ceiling
    AND ((order_type = 'market' AND limit_price IS NULL)
      OR (order_type = 'limit' AND limit_price > 0))
    AND ((action = 'ENTER_LONG' AND side = 'buy')
      OR (action IN ('REDUCE', 'CLOSE') AND side = 'sell'))
  ),
  CONSTRAINT trader_execution_plans_v2_digests CHECK (
    risk_allowance_content_digest ~ '^[0-9a-f]{64}$'
    AND decision_content_digest ~ '^[0-9a-f]{64}$'
    AND economic_size_set_digest ~ '^[0-9a-f]{64}$'
    AND instrument_identity_digest ~ '^[0-9a-f]{64}$'
    AND execution_policy_content_digest ~ '^[0-9a-f]{64}$'
    AND semantic_digest ~ '^[0-9a-f]{64}$'
    AND content_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT trader_execution_plans_v2_json CHECK (
    jsonb_typeof(price_collar) = 'object'
    AND jsonb_typeof(timing_window) = 'object'
    AND jsonb_typeof(quantity_rules) = 'object'
    AND jsonb_typeof(child_slices) = 'array'
    AND jsonb_array_length(child_slices) > 0
    AND jsonb_typeof(retry_policy) = 'object'
    AND jsonb_typeof(cancel_policy) = 'object'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_plans_v2_org_allowance_unique
  ON public.trader_execution_plans_v2 (organization_id, risk_allowance_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_plans_v2_org_content_unique
  ON public.trader_execution_plans_v2 (organization_id, content_digest);
--> statement-breakpoint
CREATE INDEX trader_execution_plans_v2_org_account_sealed_idx
  ON public.trader_execution_plans_v2 (organization_id, account_id, sealed_at);
--> statement-breakpoint
CREATE TABLE public.trader_execution_attempts_v2 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  execution_plan_id uuid NOT NULL,
  execution_plan_content_digest text NOT NULL,
  risk_allowance_id uuid NOT NULL,
  risk_allowance_content_digest text NOT NULL,
  order_id uuid NOT NULL,
  attempt_sequence bigint NOT NULL,
  effect_identity_digest text NOT NULL,
  client_order_id text NOT NULL,
  venue text NOT NULL,
  exact_request_payload jsonb NOT NULL,
  lifecycle_state text NOT NULL,
  next_report_sequence bigint NOT NULL DEFAULT 1,
  last_report_digest text,
  bound_at timestamptz NOT NULL,
  semantic_digest text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_execution_attempts_v2_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT trader_execution_attempts_v2_id_org_account_unique
    UNIQUE (id, organization_id, account_id),
  CONSTRAINT trader_execution_attempts_v2_plan_scope_fk FOREIGN KEY (
    execution_plan_id, organization_id, account_id
  ) REFERENCES public.trader_execution_plans_v2(id, organization_id, account_id),
  CONSTRAINT trader_execution_attempts_v2_allowance_scope_fk FOREIGN KEY (
    risk_allowance_id, organization_id, account_id
  ) REFERENCES public.trader_risk_allowances_v2(id, organization_id, account_id),
  CONSTRAINT trader_execution_attempts_v2_order_scope_fk FOREIGN KEY (
    order_id, organization_id
  ) REFERENCES public.trader_orders(id, organization_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT trader_execution_attempts_v2_identity CHECK (
    schema_version = 'execution-attempt/v2'
    AND attempt_sequence = 1
    AND next_report_sequence > 0
    AND lifecycle_state IN (
      'BOUND', 'SUBMIT_STARTED', 'VENUE_ACCEPTED', 'VENUE_REJECTED',
      'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCELLED',
      'RECONCILIATION_REQUIRED'
    )
    AND jsonb_typeof(exact_request_payload) = 'object'
  ),
  CONSTRAINT trader_execution_attempts_v2_report_head_complete CHECK (
    (next_report_sequence = 1 AND last_report_digest IS NULL)
    OR (next_report_sequence > 1 AND last_report_digest ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT trader_execution_attempts_v2_digests CHECK (
    execution_plan_content_digest ~ '^[0-9a-f]{64}$'
    AND risk_allowance_content_digest ~ '^[0-9a-f]{64}$'
    AND effect_identity_digest ~ '^[0-9a-f]{64}$'
    AND semantic_digest ~ '^[0-9a-f]{64}$'
    AND content_digest ~ '^[0-9a-f]{64}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_attempts_v2_org_allowance_unique
  ON public.trader_execution_attempts_v2 (organization_id, risk_allowance_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_attempts_v2_org_order_unique
  ON public.trader_execution_attempts_v2 (organization_id, order_id);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_attempts_v2_org_effect_unique
  ON public.trader_execution_attempts_v2 (organization_id, effect_identity_digest);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_attempts_v2_org_client_order_unique
  ON public.trader_execution_attempts_v2 (organization_id, client_order_id);
--> statement-breakpoint
CREATE INDEX trader_execution_attempts_v2_org_account_state_idx
  ON public.trader_execution_attempts_v2 (organization_id, account_id, lifecycle_state);
--> statement-breakpoint
CREATE TABLE public.trader_execution_reports_v2 (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  execution_attempt_id uuid NOT NULL,
  execution_attempt_content_digest text NOT NULL,
  report_sequence bigint NOT NULL,
  report_type text NOT NULL,
  source text NOT NULL,
  raw_observation jsonb NOT NULL,
  venue_order_id text,
  observed_at timestamptz NOT NULL,
  previous_report_digest text,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', transaction_timestamp()),
  CONSTRAINT trader_execution_reports_v2_attempt_scope_fk FOREIGN KEY (
    execution_attempt_id, organization_id, account_id
  ) REFERENCES public.trader_execution_attempts_v2(id, organization_id, account_id),
  CONSTRAINT trader_execution_reports_v2_identity CHECK (
    schema_version = 'execution-report/v2'
    AND report_sequence > 0
    AND source IN ('EXECUTION', 'CONNECTOR')
    AND report_type IN (
      'PLAN_SEALED', 'ALLOWANCE_CLAIMED', 'ATTEMPT_BOUND', 'SUBMIT_STARTED',
      'VENUE_ACCEPTED', 'VENUE_REJECTED', 'VENUE_STATUS_OBSERVED',
      'CANCEL_REQUESTED', 'CANCEL_ACKNOWLEDGED', 'FILL_REPORT_OBSERVED',
      'CONNECTOR_UNCERTAIN', 'RECONCILIATION_REQUIRED'
    )
    AND jsonb_typeof(raw_observation) = 'object'
  ),
  CONSTRAINT trader_execution_reports_v2_chain CHECK (
    (report_sequence = 1 AND previous_report_digest IS NULL)
    OR (report_sequence > 1 AND previous_report_digest ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT trader_execution_reports_v2_digests CHECK (
    execution_attempt_content_digest ~ '^[0-9a-f]{64}$'
    AND content_digest ~ '^[0-9a-f]{64}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_reports_v2_org_attempt_sequence_unique
  ON public.trader_execution_reports_v2 (organization_id, execution_attempt_id, report_sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX trader_execution_reports_v2_org_content_unique
  ON public.trader_execution_reports_v2 (organization_id, content_digest);
--> statement-breakpoint
CREATE INDEX trader_execution_reports_v2_org_attempt_type_idx
  ON public.trader_execution_reports_v2 (organization_id, execution_attempt_id, report_type);
--> statement-breakpoint
ALTER TABLE public.trader_orders
  ADD CONSTRAINT trader_orders_execution_plan_scope_fk FOREIGN KEY (
    execution_plan_id, organization_id
  ) REFERENCES public.trader_execution_plans_v2(id, organization_id)
  DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT trader_orders_execution_attempt_scope_fk FOREIGN KEY (
    execution_attempt_id, organization_id
  ) REFERENCES public.trader_execution_attempts_v2(id, organization_id)
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE UNIQUE INDEX trader_orders_org_execution_attempt_unique
  ON public.trader_orders (organization_id, execution_attempt_id)
  WHERE execution_attempt_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_execution_v2_block_append_only_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (no % allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_execution_v2_validate_plan_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowance_row public.trader_risk_allowances_v2%ROWTYPE;
  policy_row public.trader_execution_policies_v2%ROWTYPE;
BEGIN
  SELECT * INTO allowance_row FROM public.trader_risk_allowances_v2
  WHERE id = NEW.risk_allowance_id AND organization_id = NEW.organization_id
    AND account_id = NEW.account_id;
  SELECT * INTO policy_row FROM public.trader_execution_policies_v2
  WHERE id = NEW.execution_policy_id AND organization_id = NEW.organization_id;
  IF allowance_row.id IS NULL OR policy_row.id IS NULL
    OR allowance_row.content_digest <> NEW.risk_allowance_content_digest
    OR allowance_row.risk_verdict_id <> NEW.risk_verdict_id
    OR allowance_row.decision_id <> NEW.decision_id
    OR allowance_row.decision_content_digest <> NEW.decision_content_digest
    OR allowance_row.economic_size_set_digest <> NEW.economic_size_set_digest
    OR allowance_row.instrument_identity_digest <> NEW.instrument_identity_digest
    OR allowance_row.symbol <> NEW.symbol
    OR allowance_row.venue <> NEW.venue
    OR allowance_row.exact_qualified_quantity < NEW.planned_quantity
    OR policy_row.content_digest <> NEW.execution_policy_content_digest
    OR policy_row.decision_id <> NEW.decision_id
    OR policy_row.decision_content_digest <> NEW.decision_content_digest
    OR policy_row.economic_size_set_digest <> NEW.economic_size_set_digest
    OR policy_row.instrument_identity_digest <> NEW.instrument_identity_digest
    OR policy_row.venue <> NEW.venue
  THEN
    RAISE EXCEPTION 'Execution plan does not exactly match allowance/policy authority'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_execution_plans_v2_validate_insert
  BEFORE INSERT ON public.trader_execution_plans_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_validate_plan_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_execution_v2_validate_attempt_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  plan_row public.trader_execution_plans_v2%ROWTYPE;
  allowance_row public.trader_risk_allowances_v2%ROWTYPE;
  order_row public.trader_orders%ROWTYPE;
BEGIN
  SELECT * INTO plan_row FROM public.trader_execution_plans_v2
  WHERE id = NEW.execution_plan_id AND organization_id = NEW.organization_id
    AND account_id = NEW.account_id;
  SELECT * INTO allowance_row FROM public.trader_risk_allowances_v2
  WHERE id = NEW.risk_allowance_id AND organization_id = NEW.organization_id
    AND account_id = NEW.account_id;
  SELECT * INTO order_row FROM public.trader_orders
  WHERE id = NEW.order_id AND organization_id = NEW.organization_id;
  IF plan_row.id IS NULL OR allowance_row.id IS NULL OR order_row.id IS NULL
    OR plan_row.content_digest <> NEW.execution_plan_content_digest
    OR plan_row.risk_allowance_id <> NEW.risk_allowance_id
    OR plan_row.risk_allowance_content_digest <> NEW.risk_allowance_content_digest
    OR allowance_row.content_digest <> NEW.risk_allowance_content_digest
    OR order_row.risk_allowance_id <> NEW.risk_allowance_id
    OR order_row.client_order_id <> NEW.client_order_id
    OR order_row.symbol <> NEW.exact_request_payload->>'symbol'
    OR order_row.side::text <> NEW.exact_request_payload->>'side'
    OR order_row.type::text <> NEW.exact_request_payload->>'type'
    OR order_row.quantity <> NEW.exact_request_payload->>'quantity'
  THEN
    RAISE EXCEPTION 'Execution attempt does not exactly match plan/allowance/order authority'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_execution_attempts_v2_validate_insert
  BEFORE INSERT ON public.trader_execution_attempts_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_validate_attempt_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_execution_v2_guard_attempt_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.organization_id, NEW.account_id, NEW.execution_plan_id,
    NEW.execution_plan_content_digest, NEW.risk_allowance_id,
    NEW.risk_allowance_content_digest, NEW.order_id, NEW.attempt_sequence,
    NEW.effect_identity_digest, NEW.client_order_id, NEW.venue,
    NEW.exact_request_payload, NEW.bound_at, NEW.semantic_digest,
    NEW.content_digest, NEW.schema_version, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.organization_id, OLD.account_id, OLD.execution_plan_id,
    OLD.execution_plan_content_digest, OLD.risk_allowance_id,
    OLD.risk_allowance_content_digest, OLD.order_id, OLD.attempt_sequence,
    OLD.effect_identity_digest, OLD.client_order_id, OLD.venue,
    OLD.exact_request_payload, OLD.bound_at, OLD.semantic_digest,
    OLD.content_digest, OLD.schema_version, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Execution attempt immutable authority fields cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.next_report_sequence < OLD.next_report_sequence
    OR (NEW.lifecycle_state <> OLD.lifecycle_state
      AND NEW.next_report_sequence = OLD.next_report_sequence)
    OR (NEW.next_report_sequence > OLD.next_report_sequence
      AND (NEW.next_report_sequence <> OLD.next_report_sequence + 1
        OR NEW.last_report_digest IS NOT DISTINCT FROM OLD.last_report_digest))
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'Execution attempt projection update is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_execution_attempts_v2_guard_update
  BEFORE UPDATE ON public.trader_execution_attempts_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_guard_attempt_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_execution_v2_guard_report_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt_row public.trader_execution_attempts_v2%ROWTYPE;
BEGIN
  SELECT * INTO attempt_row FROM public.trader_execution_attempts_v2
  WHERE id = NEW.execution_attempt_id AND organization_id = NEW.organization_id
    AND account_id = NEW.account_id FOR UPDATE;
  IF attempt_row.id IS NULL
    OR attempt_row.content_digest <> NEW.execution_attempt_content_digest
    OR NEW.report_sequence <> attempt_row.next_report_sequence
    OR NEW.previous_report_digest IS DISTINCT FROM attempt_row.last_report_digest
  THEN
    RAISE EXCEPTION 'Execution report sequence/digest/attempt head mismatch'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_execution_reports_v2_guard_insert
  BEFORE INSERT ON public.trader_execution_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_guard_report_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_execution_v2_verify_report_head()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.next_report_sequence = 1 THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.trader_execution_reports_v2 report
    WHERE report.organization_id = NEW.organization_id
      AND report.account_id = NEW.account_id
      AND report.execution_attempt_id = NEW.id
      AND report.report_sequence = NEW.next_report_sequence - 1
      AND report.content_digest = NEW.last_report_digest
  ) THEN
    RAISE EXCEPTION 'Execution attempt report head is not backed by append-only ledger'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trader_execution_attempts_v2_verify_report_head
  AFTER INSERT OR UPDATE ON public.trader_execution_attempts_v2
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.waia_execution_v2_verify_report_head();
--> statement-breakpoint
CREATE TRIGGER trader_execution_policies_v2_block_update
  BEFORE UPDATE ON public.trader_execution_policies_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_execution_policies_v2_block_delete
  BEFORE DELETE ON public.trader_execution_policies_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_execution_plans_v2_block_update
  BEFORE UPDATE ON public.trader_execution_plans_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_execution_plans_v2_block_delete
  BEFORE DELETE ON public.trader_execution_plans_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_execution_attempts_v2_block_delete
  BEFORE DELETE ON public.trader_execution_attempts_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_execution_reports_v2_block_update
  BEFORE UPDATE ON public.trader_execution_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_block_append_only_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_execution_reports_v2_block_delete
  BEFORE DELETE ON public.trader_execution_reports_v2
  FOR EACH ROW EXECUTE FUNCTION public.waia_execution_v2_block_append_only_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_execution_policies_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_execution_plans_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_execution_attempts_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trader_execution_reports_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trader_execution_policies_v2_deny_client_all
  ON public.trader_execution_policies_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_execution_plans_v2_deny_client_all
  ON public.trader_execution_plans_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_execution_attempts_v2_deny_client_all
  ON public.trader_execution_attempts_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY trader_execution_reports_v2_deny_client_all
  ON public.trader_execution_reports_v2 FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_execution_policies_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_execution_plans_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_execution_attempts_v2 FROM authenticated, anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.trader_execution_reports_v2 FROM authenticated, anon;
