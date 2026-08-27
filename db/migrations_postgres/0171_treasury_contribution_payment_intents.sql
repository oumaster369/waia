-- DEE-731: non-custodial named contribution intent and public patron links.

ALTER TABLE public.treasury_contribution_attributions
  ADD COLUMN IF NOT EXISTS public_site_url text,
  ADD COLUMN IF NOT EXISTS twin_profile_url text;

CREATE TABLE IF NOT EXISTS public.treasury_contribution_payment_intents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contributor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  display_name_snapshot text NOT NULL,
  public_site_url text,
  twin_profile_url text,
  consent_public_identity boolean NOT NULL,
  requested_amount_atomic bigint NOT NULL,
  payable_amount_atomic bigint NOT NULL,
  asset_code text NOT NULL,
  network text NOT NULL,
  receiving_address text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  matched_transaction_id uuid,
  expires_at timestamptz NOT NULL,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_contribution_payment_intents_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT treasury_contribution_payment_intents_tx_same_org_fk
    FOREIGN KEY (matched_transaction_id, organization_id)
    REFERENCES public.treasury_transactions(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT treasury_contribution_payment_intents_requested_positive
    CHECK (requested_amount_atomic > 0),
  CONSTRAINT treasury_contribution_payment_intents_payable_range
    CHECK (
      payable_amount_atomic >= requested_amount_atomic
      AND payable_amount_atomic < requested_amount_atomic + 1000
    ),
  CONSTRAINT treasury_contribution_payment_intents_status_check
    CHECK (status IN ('PENDING', 'MATCHED', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT treasury_contribution_payment_intents_status_shape
    CHECK (
      (status = 'MATCHED' AND matched_transaction_id IS NOT NULL AND matched_at IS NOT NULL)
      OR
      (status <> 'MATCHED' AND matched_transaction_id IS NULL AND matched_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS treasury_contribution_payment_intents_exact_amount_uq
  ON public.treasury_contribution_payment_intents
  (receiving_address, asset_code, payable_amount_atomic);

CREATE INDEX IF NOT EXISTS treasury_contribution_payment_intents_match_idx
  ON public.treasury_contribution_payment_intents
  (organization_id, status, receiving_address, payable_amount_atomic);

CREATE INDEX IF NOT EXISTS treasury_contribution_payment_intents_user_created_idx
  ON public.treasury_contribution_payment_intents (contributor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS treasury_contribution_attributions_contributor_idx
  ON public.treasury_contribution_attributions (organization_id, contributor_user_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.treasury_contribution_payment_intents IS
  'Non-custodial payment instructions. Matching identifies a contributor but never verifies the Treasury transaction.';

COMMENT ON COLUMN public.treasury_contribution_payment_intents.payable_amount_atomic IS
  'Exact six-decimal USDT amount used for deterministic receipt matching; requested amount plus a sub-mill precision suffix.';

CREATE TABLE IF NOT EXISTS public.treasury_balance_checkpoints (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  currency text NOT NULL,
  confirmed_balance_micros bigint NOT NULL,
  as_of timestamptz NOT NULL,
  source_label text NOT NULL,
  note text NOT NULL,
  confirmed_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_balance_checkpoints_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT treasury_balance_checkpoints_nonnegative CHECK (confirmed_balance_micros >= 0),
  CONSTRAINT treasury_balance_checkpoints_currency_nonempty CHECK (length(trim(currency)) > 0),
  CONSTRAINT treasury_balance_checkpoints_source_human CHECK (source_label = 'HUMAN_CONFIRMED')
);

CREATE INDEX IF NOT EXISTS treasury_balance_checkpoints_org_as_of_idx
  ON public.treasury_balance_checkpoints (organization_id, as_of DESC);

COMMENT ON TABLE public.treasury_balance_checkpoints IS
  'Append-only Human-confirmed cash-balance baselines. Verified cash movements after as_of are applied as deltas.';
