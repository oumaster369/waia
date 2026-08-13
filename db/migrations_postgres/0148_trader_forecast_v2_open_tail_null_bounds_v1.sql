-- DEE-518 pre-IC4: canonical open Terminal tails.
-- Proven blocked under 0112/0124: lower_bound_scale8 / upper_bound_scale8 were NOT NULL,
-- so ±inf open tails could not be represented. NULL is the canonical open-end encoding:
--   lower_bound IS NULL => -inf (LOWER_TAIL)
--   upper_bound IS NULL => +inf (UPPER_TAIL)
--
-- Does not redefine A3 COMPLETE BUNDLE measurement cardinality.
-- Append-only triggers temporarily disabled only for irreversible DDL/backfill.

-- ---------------------------------------------------------------------------
-- target_bucket: nullable open ends + tail_semantics
-- ---------------------------------------------------------------------------

ALTER TABLE public.trader_forecast_target_bucket_v2
  DISABLE TRIGGER trader_forecast_target_bucket_v2_block_update;

ALTER TABLE public.trader_forecast_target_bucket_v2
  ALTER COLUMN lower_bound_scale8 DROP NOT NULL;

ALTER TABLE public.trader_forecast_target_bucket_v2
  ALTER COLUMN upper_bound_scale8 DROP NOT NULL;

ALTER TABLE public.trader_forecast_target_bucket_v2
  ADD COLUMN IF NOT EXISTS tail_semantics text NOT NULL DEFAULT 'INTERIOR';

ALTER TABLE public.trader_forecast_target_bucket_v2
  DROP CONSTRAINT IF EXISTS tftbv2_tail_semantics_check;

ALTER TABLE public.trader_forecast_target_bucket_v2
  ADD CONSTRAINT tftbv2_tail_semantics_check
  CHECK (tail_semantics IN ('LOWER_TAIL', 'INTERIOR', 'UPPER_TAIL'));

ALTER TABLE public.trader_forecast_target_bucket_v2
  DROP CONSTRAINT IF EXISTS tftbv2_open_tail_bounds_check;

ALTER TABLE public.trader_forecast_target_bucket_v2
  ADD CONSTRAINT tftbv2_open_tail_bounds_check
  CHECK (
    (
      tail_semantics = 'LOWER_TAIL'
      AND lower_bound_scale8 IS NULL
      AND upper_bound_scale8 IS NOT NULL
    )
    OR (
      tail_semantics = 'UPPER_TAIL'
      AND upper_bound_scale8 IS NULL
      AND lower_bound_scale8 IS NOT NULL
    )
    OR (
      tail_semantics = 'INTERIOR'
      AND lower_bound_scale8 IS NOT NULL
      AND upper_bound_scale8 IS NOT NULL
    )
  );

ALTER TABLE public.trader_forecast_target_bucket_v2
  ENABLE TRIGGER trader_forecast_target_bucket_v2_block_update;

-- ---------------------------------------------------------------------------
-- scenario: nullable open ends (ordinal binds to target_bucket; no invented ±inf)
-- ---------------------------------------------------------------------------

ALTER TABLE public.trader_forecast_scenario_v2
  DISABLE TRIGGER trader_forecast_scenario_v2_block_update;

ALTER TABLE public.trader_forecast_scenario_v2
  ALTER COLUMN lower_bound_scale8 DROP NOT NULL;

ALTER TABLE public.trader_forecast_scenario_v2
  ALTER COLUMN upper_bound_scale8 DROP NOT NULL;

ALTER TABLE public.trader_forecast_scenario_v2
  ENABLE TRIGGER trader_forecast_scenario_v2_block_update;
