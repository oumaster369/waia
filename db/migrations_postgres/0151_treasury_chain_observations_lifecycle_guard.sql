-- DEE-606 observation lifecycle guard correction (Human-approved).
-- Additive forward-fix: replace behavior of waia_treasury_chain_observations_block_mutation().
-- Does not rewrite 0148/0149. Does not change RLS, DELETE prohibition, table shape, or trigger names.
-- Fail-closed: any column other than the three allowlist keys remains part of the OLD-vs-NEW comparison,
-- so unknown future columns are immutable by default.

CREATE OR REPLACE FUNCTION public.waia_treasury_chain_observations_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'treasury_chain_observations is append-only (no % allowed)', TG_OP
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'confirmations_observed' - 'observation_status' - 'related_payment_id')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'confirmations_observed' - 'observation_status' - 'related_payment_id')
    THEN
      RAISE EXCEPTION 'treasury_chain_observations is append-only (no % allowed)', TG_OP
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'treasury_chain_observations is append-only (no % allowed)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;
