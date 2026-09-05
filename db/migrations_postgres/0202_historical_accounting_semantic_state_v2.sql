-- DEE-920: persist every field covered by the canonical accounting semantic digest.
-- Existing 0100 rows remain untouched. The NOT VALID constraint deliberately
-- skips the historical-table scan while still checking every row inserted after
-- this migration. New writers must therefore persist the complete group; neither
-- partial nor all-NULL semantic state can occupy a new immutable sequence slot.
ALTER TABLE public.trader_accounting_frontier
  ADD COLUMN month_key text,
  ADD COLUMN marked_position_value text,
  ADD COLUMN monthly_peak_hwm text,
  ADD COLUMN monthly_drawdown_bps integer,
  ADD COLUMN strategy_peak_hwm_by_key_json jsonb,
  ADD COLUMN strategy_drawdown_bps_by_key_json jsonb;
--> statement-breakpoint
ALTER TABLE public.trader_accounting_frontier
  ADD CONSTRAINT trader_accounting_frontier_semantic_state_complete CHECK (
    month_key IS NOT NULL AND month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND
    marked_position_value IS NOT NULL AND
    monthly_peak_hwm IS NOT NULL AND
    monthly_drawdown_bps IS NOT NULL AND monthly_drawdown_bps >= 0 AND
    strategy_peak_hwm_by_key_json IS NOT NULL AND
    jsonb_typeof(strategy_peak_hwm_by_key_json) = 'object' AND
    strategy_drawdown_bps_by_key_json IS NOT NULL AND
    jsonb_typeof(strategy_drawdown_bps_by_key_json) = 'object'
  ) NOT VALID;
