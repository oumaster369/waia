-- DEE-1152 step 2: Postgres admission journal, DEE-540 bar-content consume, discovery loop.
-- New file. Earlier migrations are unchanged. No order tables and no live-enablement columns.
--> statement-breakpoint
CREATE TABLE public.trader_strategy_admission_family (
  spec_sha256 text PRIMARY KEY CHECK (spec_sha256 ~ '^[0-9a-f]{64}$'),
  family_size integer NOT NULL CHECK (family_size >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE public.trader_strategy_admission_journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spec_sha256 text NOT NULL CHECK (spec_sha256 ~ '^[0-9a-f]{64}$'),
  hypothesis_id text NOT NULL CHECK (length(hypothesis_id) BETWEEN 1 AND 128),
  split text NOT NULL CHECK (split IN ('is', 'validation', 'holdout')),
  counts_as_split_use boolean NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX trader_strategy_admission_journal_spec_idx
  ON public.trader_strategy_admission_journal (spec_sha256, hypothesis_id, split);
--> statement-breakpoint
CREATE TABLE public.trader_strategy_admission_split_consume (
  spec_sha256 text NOT NULL CHECK (spec_sha256 ~ '^[0-9a-f]{64}$'),
  hypothesis_id text NOT NULL CHECK (length(hypothesis_id) BETWEEN 1 AND 128),
  split text NOT NULL CHECK (split IN ('validation', 'holdout')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spec_sha256, hypothesis_id, split)
);
--> statement-breakpoint
CREATE TABLE public.trader_dee540_bar_consumption (
  bar_content_token text PRIMARY KEY CHECK (bar_content_token ~ '^[0-9a-f]{64}$'),
  blind_digest text NOT NULL CHECK (blind_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE public.trader_discovery_loop_run (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id text NOT NULL CHECK (length(campaign_id) BETWEEN 1 AND 200),
  skipped boolean NOT NULL,
  status text,
  reason text,
  capital_authority text,
  content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX trader_discovery_loop_run_org_created_idx
  ON public.trader_discovery_loop_run (organization_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE public.trader_discovery_loop_trial (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.trader_discovery_loop_run(id) ON DELETE CASCADE,
  trial_index integer NOT NULL CHECK (trial_index >= 0),
  hypothesis_id text NOT NULL CHECK (length(hypothesis_id) BETWEEN 1 AND 128),
  raw_p_value text NOT NULL,
  adjusted_p_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, trial_index)
);
--> statement-breakpoint
CREATE TABLE public.trader_discovery_loop_verdict (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.trader_discovery_loop_run(id) ON DELETE CASCADE,
  partition text NOT NULL CHECK (partition IN ('DEVELOPMENT', 'WALK_FORWARD')),
  verdict text NOT NULL,
  admission_verdict text NOT NULL,
  scored boolean NOT NULL,
  reasons_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, partition)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trader_discovery_loop_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only discovery admission store';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trader_strategy_admission_family_append_only
  BEFORE UPDATE OR DELETE ON public.trader_strategy_admission_family
  FOR EACH ROW EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_strategy_admission_journal_append_only
  BEFORE UPDATE OR DELETE ON public.trader_strategy_admission_journal
  FOR EACH ROW EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_strategy_admission_split_consume_append_only
  BEFORE UPDATE OR DELETE ON public.trader_strategy_admission_split_consume
  FOR EACH ROW EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_dee540_bar_consumption_append_only
  BEFORE UPDATE OR DELETE ON public.trader_dee540_bar_consumption
  FOR EACH ROW EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_discovery_loop_run_append_only
  BEFORE UPDATE OR DELETE ON public.trader_discovery_loop_run
  FOR EACH ROW EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_discovery_loop_trial_append_only
  BEFORE UPDATE OR DELETE ON public.trader_discovery_loop_trial
  FOR EACH ROW EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER trader_discovery_loop_verdict_append_only
  BEFORE UPDATE OR DELETE ON public.trader_discovery_loop_verdict
  FOR EACH ROW EXECUTE FUNCTION public.trader_discovery_loop_reject_mutation();
