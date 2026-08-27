-- DEE-731: browser roles cannot read or mutate contribution intents directly.

CREATE OR REPLACE FUNCTION public.guard_treasury_contribution_payment_intent_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.contributor_user_id IS DISTINCT FROM NEW.contributor_user_id
    OR OLD.display_name_snapshot IS DISTINCT FROM NEW.display_name_snapshot
    OR OLD.public_site_url IS DISTINCT FROM NEW.public_site_url
    OR OLD.twin_profile_url IS DISTINCT FROM NEW.twin_profile_url
    OR OLD.consent_public_identity IS DISTINCT FROM NEW.consent_public_identity
    OR OLD.requested_amount_atomic IS DISTINCT FROM NEW.requested_amount_atomic
    OR OLD.payable_amount_atomic IS DISTINCT FROM NEW.payable_amount_atomic
    OR OLD.asset_code IS DISTINCT FROM NEW.asset_code
    OR OLD.network IS DISTINCT FROM NEW.network
    OR OLD.receiving_address IS DISTINCT FROM NEW.receiving_address
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'contribution payment intent authority fields are immutable';
  END IF;

  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('MATCHED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'invalid contribution payment intent lifecycle transition';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS treasury_contribution_payment_intent_transition_guard
  ON public.treasury_contribution_payment_intents;
CREATE TRIGGER treasury_contribution_payment_intent_transition_guard
BEFORE UPDATE ON public.treasury_contribution_payment_intents
FOR EACH ROW EXECUTE FUNCTION public.guard_treasury_contribution_payment_intent_transition();

CREATE OR REPLACE FUNCTION public.guard_treasury_contribution_payment_intent_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'contribution payment intents are audit records and cannot be deleted';
END;
$$;

DROP TRIGGER IF EXISTS treasury_contribution_payment_intent_delete_guard
  ON public.treasury_contribution_payment_intents;
CREATE TRIGGER treasury_contribution_payment_intent_delete_guard
BEFORE DELETE ON public.treasury_contribution_payment_intents
FOR EACH ROW EXECUTE FUNCTION public.guard_treasury_contribution_payment_intent_delete();

ALTER TABLE public.treasury_contribution_payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY treasury_contribution_payment_intents_deny_anon_all
  ON public.treasury_contribution_payment_intents
  FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY treasury_contribution_payment_intents_deny_authenticated_all
  ON public.treasury_contribution_payment_intents
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.treasury_contribution_payment_intents FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_treasury_contribution_payment_intent_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_treasury_contribution_payment_intent_delete() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.guard_treasury_balance_checkpoint_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'treasury balance checkpoints are append-only';
END;
$$;

DROP TRIGGER IF EXISTS treasury_balance_checkpoint_update_guard
  ON public.treasury_balance_checkpoints;
CREATE TRIGGER treasury_balance_checkpoint_update_guard
BEFORE UPDATE ON public.treasury_balance_checkpoints
FOR EACH ROW EXECUTE FUNCTION public.guard_treasury_balance_checkpoint_mutation();

DROP TRIGGER IF EXISTS treasury_balance_checkpoint_delete_guard
  ON public.treasury_balance_checkpoints;
CREATE TRIGGER treasury_balance_checkpoint_delete_guard
BEFORE DELETE ON public.treasury_balance_checkpoints
FOR EACH ROW EXECUTE FUNCTION public.guard_treasury_balance_checkpoint_mutation();

ALTER TABLE public.treasury_balance_checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY treasury_balance_checkpoints_deny_anon_all
  ON public.treasury_balance_checkpoints
  FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY treasury_balance_checkpoints_deny_authenticated_all
  ON public.treasury_balance_checkpoints
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.treasury_balance_checkpoints FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_treasury_balance_checkpoint_mutation() FROM PUBLIC;
