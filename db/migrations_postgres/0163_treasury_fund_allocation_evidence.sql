-- DEE-690: immutable virtual Development Fund allocation evidence.
-- Accounting truth only: no transaction rewrite, custody mutation, or physical transfer.

ALTER TABLE public.treasury_ideal_annual_budgets
  ADD CONSTRAINT treasury_ideal_budgets_id_org_uq UNIQUE (id, organization_id);
--> statement-breakpoint
ALTER TABLE public.treasury_balance_reconciliations
  ADD CONSTRAINT treasury_balance_recon_id_org_uq UNIQUE (id, organization_id);
--> statement-breakpoint
CREATE TABLE public.treasury_fund_allocation_evidence (
  id uuid PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_code text NOT NULL,
  policy_version integer NOT NULL,
  accounting_currency text NOT NULL,
  ideal_annual_budget_id uuid NOT NULL,
  balance_reconciliation_id uuid NOT NULL,
  accounting_as_of timestamptz NOT NULL,
  accounting_cash_balance_micros bigint NOT NULL,
  active_commitments_micros bigint NOT NULL,
  canonical_free_funds_micros bigint NOT NULL,
  protected_annual_budget_micros bigint NOT NULL,
  operating_allocation_micros bigint NOT NULL,
  development_allocation_micros bigint NOT NULL,
  input_digest text NOT NULL,
  output_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_fund_alloc_evidence_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT treasury_fund_alloc_evidence_ideal_same_org_fk FOREIGN KEY (
    ideal_annual_budget_id, organization_id
  ) REFERENCES public.treasury_ideal_annual_budgets(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT treasury_fund_alloc_evidence_recon_same_org_fk FOREIGN KEY (
    balance_reconciliation_id, organization_id
  ) REFERENCES public.treasury_balance_reconciliations(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT treasury_fund_alloc_evidence_policy_check CHECK (
    policy_code = 'WAIA_DEVELOPMENT_FUND_EXCESS_ANNUAL_BUDGET' AND policy_version = 1
  ),
  CONSTRAINT treasury_fund_alloc_evidence_currency_check CHECK (
    accounting_currency ~ '^[A-Z][A-Z0-9]{2,11}$'
  ),
  CONSTRAINT treasury_fund_alloc_evidence_digest_check CHECK (
    input_digest ~ '^[0-9a-f]{64}$' AND output_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT treasury_fund_alloc_evidence_amounts_check CHECK (
    accounting_cash_balance_micros >= 0
    AND active_commitments_micros >= 0
    AND canonical_free_funds_micros >= 0
    AND protected_annual_budget_micros > 0
    AND operating_allocation_micros >= 0
    AND development_allocation_micros >= 0
  ),
  CONSTRAINT treasury_fund_alloc_evidence_formula_check CHECK (
    canonical_free_funds_micros = accounting_cash_balance_micros - active_commitments_micros
    AND operating_allocation_micros = LEAST(canonical_free_funds_micros, protected_annual_budget_micros)
    AND development_allocation_micros = GREATEST(0, canonical_free_funds_micros - protected_annual_budget_micros)
    AND operating_allocation_micros + development_allocation_micros = canonical_free_funds_micros
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX treasury_fund_alloc_evidence_input_uq
  ON public.treasury_fund_allocation_evidence (organization_id, input_digest);
--> statement-breakpoint
CREATE INDEX treasury_fund_alloc_evidence_latest_idx
  ON public.treasury_fund_allocation_evidence (organization_id, created_at DESC, id DESC);
