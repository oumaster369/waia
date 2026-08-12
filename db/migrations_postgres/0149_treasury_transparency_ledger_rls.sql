-- DEE-606 WP-1: Treasury targeted RLS + append-only guards (ADR-0007).
-- Hand-authored; deny authenticated/anon direct access.

CREATE OR REPLACE FUNCTION public.waia_treasury_chain_observations_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'treasury_chain_observations is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS treasury_chain_observations_block_update ON public.treasury_chain_observations;
--> statement-breakpoint
CREATE TRIGGER treasury_chain_observations_block_update
  BEFORE UPDATE ON public.treasury_chain_observations
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_chain_observations_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS treasury_chain_observations_block_delete ON public.treasury_chain_observations;
--> statement-breakpoint
CREATE TRIGGER treasury_chain_observations_block_delete
  BEFORE DELETE ON public.treasury_chain_observations
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_chain_observations_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_treasury_transaction_revisions_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'treasury_transaction_revisions is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS treasury_transaction_revisions_block_update ON public.treasury_transaction_revisions;
--> statement-breakpoint
CREATE TRIGGER treasury_transaction_revisions_block_update
  BEFORE UPDATE ON public.treasury_transaction_revisions
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_transaction_revisions_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS treasury_transaction_revisions_block_delete ON public.treasury_transaction_revisions;
--> statement-breakpoint
CREATE TRIGGER treasury_transaction_revisions_block_delete
  BEFORE DELETE ON public.treasury_transaction_revisions
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_transaction_revisions_block_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.waia_treasury_commitment_revisions_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'treasury_commitment_revisions is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS treasury_commitment_revisions_block_update ON public.treasury_commitment_revisions;
--> statement-breakpoint
CREATE TRIGGER treasury_commitment_revisions_block_update
  BEFORE UPDATE ON public.treasury_commitment_revisions
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_commitment_revisions_block_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS treasury_commitment_revisions_block_delete ON public.treasury_commitment_revisions;
--> statement-breakpoint
CREATE TRIGGER treasury_commitment_revisions_block_delete
  BEFORE DELETE ON public.treasury_commitment_revisions
  FOR EACH ROW EXECUTE FUNCTION public.waia_treasury_commitment_revisions_block_mutation();
--> statement-breakpoint
ALTER TABLE public.treasury_fund_buckets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_fund_buckets_deny_authenticated_select ON public.treasury_fund_buckets;
--> statement-breakpoint
CREATE POLICY treasury_fund_buckets_deny_authenticated_select ON public.treasury_fund_buckets
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_fund_buckets_deny_authenticated_insert ON public.treasury_fund_buckets;
--> statement-breakpoint
CREATE POLICY treasury_fund_buckets_deny_authenticated_insert ON public.treasury_fund_buckets
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_fund_buckets_deny_authenticated_update ON public.treasury_fund_buckets;
--> statement-breakpoint
CREATE POLICY treasury_fund_buckets_deny_authenticated_update ON public.treasury_fund_buckets
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_fund_buckets_deny_authenticated_delete ON public.treasury_fund_buckets;
--> statement-breakpoint
CREATE POLICY treasury_fund_buckets_deny_authenticated_delete ON public.treasury_fund_buckets
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_watched_addresses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watched_addresses_deny_authenticated_select ON public.treasury_watched_addresses;
--> statement-breakpoint
CREATE POLICY treasury_watched_addresses_deny_authenticated_select ON public.treasury_watched_addresses
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watched_addresses_deny_authenticated_insert ON public.treasury_watched_addresses;
--> statement-breakpoint
CREATE POLICY treasury_watched_addresses_deny_authenticated_insert ON public.treasury_watched_addresses
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watched_addresses_deny_authenticated_update ON public.treasury_watched_addresses;
--> statement-breakpoint
CREATE POLICY treasury_watched_addresses_deny_authenticated_update ON public.treasury_watched_addresses
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watched_addresses_deny_authenticated_delete ON public.treasury_watched_addresses;
--> statement-breakpoint
CREATE POLICY treasury_watched_addresses_deny_authenticated_delete ON public.treasury_watched_addresses
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_watcher_checkpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watcher_checkpoints_deny_authenticated_select ON public.treasury_watcher_checkpoints;
--> statement-breakpoint
CREATE POLICY treasury_watcher_checkpoints_deny_authenticated_select ON public.treasury_watcher_checkpoints
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watcher_checkpoints_deny_authenticated_insert ON public.treasury_watcher_checkpoints;
--> statement-breakpoint
CREATE POLICY treasury_watcher_checkpoints_deny_authenticated_insert ON public.treasury_watcher_checkpoints
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watcher_checkpoints_deny_authenticated_update ON public.treasury_watcher_checkpoints;
--> statement-breakpoint
CREATE POLICY treasury_watcher_checkpoints_deny_authenticated_update ON public.treasury_watcher_checkpoints
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_watcher_checkpoints_deny_authenticated_delete ON public.treasury_watcher_checkpoints;
--> statement-breakpoint
CREATE POLICY treasury_watcher_checkpoints_deny_authenticated_delete ON public.treasury_watcher_checkpoints
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_evidence_objects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_objects_deny_authenticated_select ON public.treasury_evidence_objects;
--> statement-breakpoint
CREATE POLICY treasury_evidence_objects_deny_authenticated_select ON public.treasury_evidence_objects
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_objects_deny_authenticated_insert ON public.treasury_evidence_objects;
--> statement-breakpoint
CREATE POLICY treasury_evidence_objects_deny_authenticated_insert ON public.treasury_evidence_objects
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_objects_deny_authenticated_update ON public.treasury_evidence_objects;
--> statement-breakpoint
CREATE POLICY treasury_evidence_objects_deny_authenticated_update ON public.treasury_evidence_objects
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_objects_deny_authenticated_delete ON public.treasury_evidence_objects;
--> statement-breakpoint
CREATE POLICY treasury_evidence_objects_deny_authenticated_delete ON public.treasury_evidence_objects
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_budgets_deny_authenticated_select ON public.treasury_budgets;
--> statement-breakpoint
CREATE POLICY treasury_budgets_deny_authenticated_select ON public.treasury_budgets
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_budgets_deny_authenticated_insert ON public.treasury_budgets;
--> statement-breakpoint
CREATE POLICY treasury_budgets_deny_authenticated_insert ON public.treasury_budgets
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_budgets_deny_authenticated_update ON public.treasury_budgets;
--> statement-breakpoint
CREATE POLICY treasury_budgets_deny_authenticated_update ON public.treasury_budgets
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_budgets_deny_authenticated_delete ON public.treasury_budgets;
--> statement-breakpoint
CREATE POLICY treasury_budgets_deny_authenticated_delete ON public.treasury_budgets
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_funding_needs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_funding_needs_deny_authenticated_select ON public.treasury_funding_needs;
--> statement-breakpoint
CREATE POLICY treasury_funding_needs_deny_authenticated_select ON public.treasury_funding_needs
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_funding_needs_deny_authenticated_insert ON public.treasury_funding_needs;
--> statement-breakpoint
CREATE POLICY treasury_funding_needs_deny_authenticated_insert ON public.treasury_funding_needs
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_funding_needs_deny_authenticated_update ON public.treasury_funding_needs;
--> statement-breakpoint
CREATE POLICY treasury_funding_needs_deny_authenticated_update ON public.treasury_funding_needs
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_funding_needs_deny_authenticated_delete ON public.treasury_funding_needs;
--> statement-breakpoint
CREATE POLICY treasury_funding_needs_deny_authenticated_delete ON public.treasury_funding_needs
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_runway_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_plans_deny_authenticated_select ON public.treasury_runway_plans;
--> statement-breakpoint
CREATE POLICY treasury_runway_plans_deny_authenticated_select ON public.treasury_runway_plans
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_plans_deny_authenticated_insert ON public.treasury_runway_plans;
--> statement-breakpoint
CREATE POLICY treasury_runway_plans_deny_authenticated_insert ON public.treasury_runway_plans
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_plans_deny_authenticated_update ON public.treasury_runway_plans;
--> statement-breakpoint
CREATE POLICY treasury_runway_plans_deny_authenticated_update ON public.treasury_runway_plans
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_plans_deny_authenticated_delete ON public.treasury_runway_plans;
--> statement-breakpoint
CREATE POLICY treasury_runway_plans_deny_authenticated_delete ON public.treasury_runway_plans
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_publication_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_publication_settings_deny_authenticated_select ON public.treasury_publication_settings;
--> statement-breakpoint
CREATE POLICY treasury_publication_settings_deny_authenticated_select ON public.treasury_publication_settings
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_publication_settings_deny_authenticated_insert ON public.treasury_publication_settings;
--> statement-breakpoint
CREATE POLICY treasury_publication_settings_deny_authenticated_insert ON public.treasury_publication_settings
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_publication_settings_deny_authenticated_update ON public.treasury_publication_settings;
--> statement-breakpoint
CREATE POLICY treasury_publication_settings_deny_authenticated_update ON public.treasury_publication_settings
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_publication_settings_deny_authenticated_delete ON public.treasury_publication_settings;
--> statement-breakpoint
CREATE POLICY treasury_publication_settings_deny_authenticated_delete ON public.treasury_publication_settings
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_ideal_annual_budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ideal_annual_budgets_deny_authenticated_select ON public.treasury_ideal_annual_budgets;
--> statement-breakpoint
CREATE POLICY treasury_ideal_annual_budgets_deny_authenticated_select ON public.treasury_ideal_annual_budgets
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ideal_annual_budgets_deny_authenticated_insert ON public.treasury_ideal_annual_budgets;
--> statement-breakpoint
CREATE POLICY treasury_ideal_annual_budgets_deny_authenticated_insert ON public.treasury_ideal_annual_budgets
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ideal_annual_budgets_deny_authenticated_update ON public.treasury_ideal_annual_budgets;
--> statement-breakpoint
CREATE POLICY treasury_ideal_annual_budgets_deny_authenticated_update ON public.treasury_ideal_annual_budgets
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ideal_annual_budgets_deny_authenticated_delete ON public.treasury_ideal_annual_budgets;
--> statement-breakpoint
CREATE POLICY treasury_ideal_annual_budgets_deny_authenticated_delete ON public.treasury_ideal_annual_budgets
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_chain_observations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_chain_observations_deny_authenticated_select ON public.treasury_chain_observations;
--> statement-breakpoint
CREATE POLICY treasury_chain_observations_deny_authenticated_select ON public.treasury_chain_observations
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_chain_observations_deny_authenticated_insert ON public.treasury_chain_observations;
--> statement-breakpoint
CREATE POLICY treasury_chain_observations_deny_authenticated_insert ON public.treasury_chain_observations
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_chain_observations_deny_authenticated_update ON public.treasury_chain_observations;
--> statement-breakpoint
CREATE POLICY treasury_chain_observations_deny_authenticated_update ON public.treasury_chain_observations
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_chain_observations_deny_authenticated_delete ON public.treasury_chain_observations;
--> statement-breakpoint
CREATE POLICY treasury_chain_observations_deny_authenticated_delete ON public.treasury_chain_observations
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transactions_deny_authenticated_select ON public.treasury_transactions;
--> statement-breakpoint
CREATE POLICY treasury_transactions_deny_authenticated_select ON public.treasury_transactions
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transactions_deny_authenticated_insert ON public.treasury_transactions;
--> statement-breakpoint
CREATE POLICY treasury_transactions_deny_authenticated_insert ON public.treasury_transactions
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transactions_deny_authenticated_update ON public.treasury_transactions;
--> statement-breakpoint
CREATE POLICY treasury_transactions_deny_authenticated_update ON public.treasury_transactions
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transactions_deny_authenticated_delete ON public.treasury_transactions;
--> statement-breakpoint
CREATE POLICY treasury_transactions_deny_authenticated_delete ON public.treasury_transactions
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_ledger_inceptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ledger_inceptions_deny_authenticated_select ON public.treasury_ledger_inceptions;
--> statement-breakpoint
CREATE POLICY treasury_ledger_inceptions_deny_authenticated_select ON public.treasury_ledger_inceptions
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ledger_inceptions_deny_authenticated_insert ON public.treasury_ledger_inceptions;
--> statement-breakpoint
CREATE POLICY treasury_ledger_inceptions_deny_authenticated_insert ON public.treasury_ledger_inceptions
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ledger_inceptions_deny_authenticated_update ON public.treasury_ledger_inceptions;
--> statement-breakpoint
CREATE POLICY treasury_ledger_inceptions_deny_authenticated_update ON public.treasury_ledger_inceptions
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_ledger_inceptions_deny_authenticated_delete ON public.treasury_ledger_inceptions;
--> statement-breakpoint
CREATE POLICY treasury_ledger_inceptions_deny_authenticated_delete ON public.treasury_ledger_inceptions
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_transaction_observation_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_observation_links_deny_authenticated_select ON public.treasury_transaction_observation_links;
--> statement-breakpoint
CREATE POLICY treasury_transaction_observation_links_deny_authenticated_select ON public.treasury_transaction_observation_links
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_observation_links_deny_authenticated_insert ON public.treasury_transaction_observation_links;
--> statement-breakpoint
CREATE POLICY treasury_transaction_observation_links_deny_authenticated_insert ON public.treasury_transaction_observation_links
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_observation_links_deny_authenticated_update ON public.treasury_transaction_observation_links;
--> statement-breakpoint
CREATE POLICY treasury_transaction_observation_links_deny_authenticated_update ON public.treasury_transaction_observation_links
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_observation_links_deny_authenticated_delete ON public.treasury_transaction_observation_links;
--> statement-breakpoint
CREATE POLICY treasury_transaction_observation_links_deny_authenticated_delete ON public.treasury_transaction_observation_links
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_transaction_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_revisions_deny_authenticated_select ON public.treasury_transaction_revisions;
--> statement-breakpoint
CREATE POLICY treasury_transaction_revisions_deny_authenticated_select ON public.treasury_transaction_revisions
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_revisions_deny_authenticated_insert ON public.treasury_transaction_revisions;
--> statement-breakpoint
CREATE POLICY treasury_transaction_revisions_deny_authenticated_insert ON public.treasury_transaction_revisions
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_revisions_deny_authenticated_update ON public.treasury_transaction_revisions;
--> statement-breakpoint
CREATE POLICY treasury_transaction_revisions_deny_authenticated_update ON public.treasury_transaction_revisions
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_transaction_revisions_deny_authenticated_delete ON public.treasury_transaction_revisions;
--> statement-breakpoint
CREATE POLICY treasury_transaction_revisions_deny_authenticated_delete ON public.treasury_transaction_revisions
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_evidence_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_links_deny_authenticated_select ON public.treasury_evidence_links;
--> statement-breakpoint
CREATE POLICY treasury_evidence_links_deny_authenticated_select ON public.treasury_evidence_links
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_links_deny_authenticated_insert ON public.treasury_evidence_links;
--> statement-breakpoint
CREATE POLICY treasury_evidence_links_deny_authenticated_insert ON public.treasury_evidence_links
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_links_deny_authenticated_update ON public.treasury_evidence_links;
--> statement-breakpoint
CREATE POLICY treasury_evidence_links_deny_authenticated_update ON public.treasury_evidence_links
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_evidence_links_deny_authenticated_delete ON public.treasury_evidence_links;
--> statement-breakpoint
CREATE POLICY treasury_evidence_links_deny_authenticated_delete ON public.treasury_evidence_links
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_contribution_attributions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_contribution_attributions_deny_authenticated_select ON public.treasury_contribution_attributions;
--> statement-breakpoint
CREATE POLICY treasury_contribution_attributions_deny_authenticated_select ON public.treasury_contribution_attributions
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_contribution_attributions_deny_authenticated_insert ON public.treasury_contribution_attributions;
--> statement-breakpoint
CREATE POLICY treasury_contribution_attributions_deny_authenticated_insert ON public.treasury_contribution_attributions
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_contribution_attributions_deny_authenticated_update ON public.treasury_contribution_attributions;
--> statement-breakpoint
CREATE POLICY treasury_contribution_attributions_deny_authenticated_update ON public.treasury_contribution_attributions
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_contribution_attributions_deny_authenticated_delete ON public.treasury_contribution_attributions;
--> statement-breakpoint
CREATE POLICY treasury_contribution_attributions_deny_authenticated_delete ON public.treasury_contribution_attributions
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_commitments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitments_deny_authenticated_select ON public.treasury_commitments;
--> statement-breakpoint
CREATE POLICY treasury_commitments_deny_authenticated_select ON public.treasury_commitments
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitments_deny_authenticated_insert ON public.treasury_commitments;
--> statement-breakpoint
CREATE POLICY treasury_commitments_deny_authenticated_insert ON public.treasury_commitments
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitments_deny_authenticated_update ON public.treasury_commitments;
--> statement-breakpoint
CREATE POLICY treasury_commitments_deny_authenticated_update ON public.treasury_commitments
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitments_deny_authenticated_delete ON public.treasury_commitments;
--> statement-breakpoint
CREATE POLICY treasury_commitments_deny_authenticated_delete ON public.treasury_commitments
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_commitment_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitment_revisions_deny_authenticated_select ON public.treasury_commitment_revisions;
--> statement-breakpoint
CREATE POLICY treasury_commitment_revisions_deny_authenticated_select ON public.treasury_commitment_revisions
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitment_revisions_deny_authenticated_insert ON public.treasury_commitment_revisions;
--> statement-breakpoint
CREATE POLICY treasury_commitment_revisions_deny_authenticated_insert ON public.treasury_commitment_revisions
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitment_revisions_deny_authenticated_update ON public.treasury_commitment_revisions;
--> statement-breakpoint
CREATE POLICY treasury_commitment_revisions_deny_authenticated_update ON public.treasury_commitment_revisions
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_commitment_revisions_deny_authenticated_delete ON public.treasury_commitment_revisions;
--> statement-breakpoint
CREATE POLICY treasury_commitment_revisions_deny_authenticated_delete ON public.treasury_commitment_revisions
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_runway_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_snapshots_deny_authenticated_select ON public.treasury_runway_snapshots;
--> statement-breakpoint
CREATE POLICY treasury_runway_snapshots_deny_authenticated_select ON public.treasury_runway_snapshots
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_snapshots_deny_authenticated_insert ON public.treasury_runway_snapshots;
--> statement-breakpoint
CREATE POLICY treasury_runway_snapshots_deny_authenticated_insert ON public.treasury_runway_snapshots
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_snapshots_deny_authenticated_update ON public.treasury_runway_snapshots;
--> statement-breakpoint
CREATE POLICY treasury_runway_snapshots_deny_authenticated_update ON public.treasury_runway_snapshots
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_runway_snapshots_deny_authenticated_delete ON public.treasury_runway_snapshots;
--> statement-breakpoint
CREATE POLICY treasury_runway_snapshots_deny_authenticated_delete ON public.treasury_runway_snapshots
  FOR DELETE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
ALTER TABLE public.treasury_balance_reconciliations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_balance_reconciliations_deny_authenticated_select ON public.treasury_balance_reconciliations;
--> statement-breakpoint
CREATE POLICY treasury_balance_reconciliations_deny_authenticated_select ON public.treasury_balance_reconciliations
  FOR SELECT
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_balance_reconciliations_deny_authenticated_insert ON public.treasury_balance_reconciliations;
--> statement-breakpoint
CREATE POLICY treasury_balance_reconciliations_deny_authenticated_insert ON public.treasury_balance_reconciliations
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_balance_reconciliations_deny_authenticated_update ON public.treasury_balance_reconciliations;
--> statement-breakpoint
CREATE POLICY treasury_balance_reconciliations_deny_authenticated_update ON public.treasury_balance_reconciliations
  FOR UPDATE
  TO authenticated, anon
  USING (false);
--> statement-breakpoint
DROP POLICY IF EXISTS treasury_balance_reconciliations_deny_authenticated_delete ON public.treasury_balance_reconciliations;
--> statement-breakpoint
CREATE POLICY treasury_balance_reconciliations_deny_authenticated_delete ON public.treasury_balance_reconciliations
  FOR DELETE
  TO authenticated, anon
  USING (false);
