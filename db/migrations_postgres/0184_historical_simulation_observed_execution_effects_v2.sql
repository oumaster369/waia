ALTER TABLE "trader_historical_simulation_reason_ledger_v2"
  ADD COLUMN "observed_execution_effects_json" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "trader_historical_simulation_reason_ledger_v2"
  ADD CONSTRAINT "historical_sim_v2_observed_effects_array"
  CHECK (jsonb_typeof("observed_execution_effects_json") = 'array');

COMMENT ON COLUMN "trader_historical_simulation_reason_ledger_v2"."observed_execution_effects_json" IS
  'Simulation-only effects realized on this bar from prior decisions; never canonical Reality V2 or capital authority.';
