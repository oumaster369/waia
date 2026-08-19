-- DEE-654 Split A: additive three-time PIT compatibility + trust-as-of receipt foundation.
-- Postgres only. This migration is authored for CI/staged operator use; DEE-654 applies no production SQL.

ALTER TABLE public.trader_mi_source_trust
  ADD COLUMN available_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.trader_mi_observation
  ADD COLUMN available_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.trader_mi_source_trust
  ADD CONSTRAINT trader_mi_source_trust_id_organization_source_unique
  UNIQUE (id, organization_id, source_id);
--> statement-breakpoint
CREATE TABLE public.trader_mi_trust_as_of_receipt_v1 (
  id text PRIMARY KEY NOT NULL,
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  anchor_time timestamp with time zone NOT NULL,
  status text NOT NULL,
  unknown_reason text,
  selected_trust_revision_id uuid,
  selected_revision_seq integer,
  selected_content_digest text,
  selected_trust_score text,
  visible_prefix_digest text NOT NULL,
  receipt_json text NOT NULL,
  content_digest text NOT NULL,
  schema_version text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tmtaor_v1_id_is_digest_check CHECK (id = content_digest),
  CONSTRAINT tmtaor_v1_id_hex_check CHECK (id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tmtaor_v1_visible_prefix_digest_check CHECK (
    visible_prefix_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT tmtaor_v1_selected_content_digest_check CHECK (
    selected_content_digest IS NULL OR selected_content_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT tmtaor_v1_status_coherence_check CHECK (
    (
      status = 'RESOLVED'
      AND unknown_reason IS NULL
      AND selected_trust_revision_id IS NOT NULL
      AND selected_revision_seq IS NOT NULL
      AND selected_content_digest IS NOT NULL
      AND selected_trust_score IS NOT NULL
    ) OR (
      status = 'UNKNOWN'
      AND unknown_reason IS NOT NULL
      AND selected_trust_revision_id IS NULL
      AND selected_revision_seq IS NULL
      AND selected_content_digest IS NULL
      AND selected_trust_score IS NULL
    )
  )
);
--> statement-breakpoint
ALTER TABLE public.trader_mi_trust_as_of_receipt_v1
  ADD CONSTRAINT tmtaor_v1_organization_fk
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_trust_as_of_receipt_v1
  ADD CONSTRAINT tmtaor_v1_source_organization_fk
  FOREIGN KEY (source_id, organization_id)
  REFERENCES public.trader_mi_source(id, organization_id)
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.trader_mi_trust_as_of_receipt_v1
  ADD CONSTRAINT tmtaor_v1_selected_revision_organization_fk
  FOREIGN KEY (selected_trust_revision_id, organization_id, source_id)
  REFERENCES public.trader_mi_source_trust(id, organization_id, source_id);
--> statement-breakpoint
CREATE UNIQUE INDEX tmtaor_v1_org_source_anchor_digest_uq
  ON public.trader_mi_trust_as_of_receipt_v1 (
    organization_id,
    source_id,
    anchor_time,
    content_digest
  );
--> statement-breakpoint
CREATE INDEX tmtaor_v1_org_source_anchor_idx
  ON public.trader_mi_trust_as_of_receipt_v1 (organization_id, source_id, anchor_time);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_mi_trust_as_of_receipt_v1_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trader_mi_trust_as_of_receipt_v1 is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_trust_as_of_receipt_v1_block_update
  ON public.trader_mi_trust_as_of_receipt_v1;
CREATE TRIGGER trader_mi_trust_as_of_receipt_v1_block_update
  BEFORE UPDATE ON public.trader_mi_trust_as_of_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_trust_as_of_receipt_v1_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trader_mi_trust_as_of_receipt_v1_block_delete
  ON public.trader_mi_trust_as_of_receipt_v1;
CREATE TRIGGER trader_mi_trust_as_of_receipt_v1_block_delete
  BEFORE DELETE ON public.trader_mi_trust_as_of_receipt_v1
  FOR EACH ROW EXECUTE FUNCTION public.waia_mi_trust_as_of_receipt_v1_block_mutation();
--> statement-breakpoint
ALTER TABLE public.trader_mi_trust_as_of_receipt_v1 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trader_mi_trust_as_of_receipt_v1_deny_authenticated_all
  ON public.trader_mi_trust_as_of_receipt_v1 FOR ALL
  TO authenticated, anon USING (false) WITH CHECK (false);
