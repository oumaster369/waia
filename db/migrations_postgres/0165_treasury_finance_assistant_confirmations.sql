-- DEE-705: single-use receipts for explicit Human-confirmed Finance Assistant writes.
-- Contains no prompt text, report data, credentials, or financial field values.

CREATE TABLE public.treasury_finance_assistant_confirmations (
  id uuid PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  intent text NOT NULL,
  nonce_digest text NOT NULL,
  fields_digest text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT treasury_finance_assistant_confirmation_intent_check CHECK (
    intent IN (
      'CREATE_COUNTERPARTY',
      'CREATE_ACCOUNT',
      'CREATE_CATEGORY',
      'CREATE_PROJECT',
      'CREATE_TRANSACTION'
    )
  ),
  CONSTRAINT treasury_finance_assistant_confirmation_digest_check CHECK (
    nonce_digest ~ '^[0-9a-f]{64}$' AND fields_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT treasury_finance_assistant_confirmation_time_check CHECK (
    issued_at <= consumed_at AND consumed_at <= expires_at
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX treasury_finance_assistant_confirmation_nonce_uq
  ON public.treasury_finance_assistant_confirmations (nonce_digest);
--> statement-breakpoint
CREATE INDEX treasury_finance_assistant_confirmation_org_consumed_idx
  ON public.treasury_finance_assistant_confirmations (organization_id, consumed_at DESC);
