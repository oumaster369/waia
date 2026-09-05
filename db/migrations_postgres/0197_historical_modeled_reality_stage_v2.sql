-- DEE-920: keep modeled historical Reality separate from canonical venue Reality.
-- The new stage remains inside the existing append-only, tenant-scoped atomic-cycle tables.
ALTER TABLE trader_historical_simulation_atomic_stage_v2
  DROP CONSTRAINT historical_sim_atomic_stage_kind;

ALTER TABLE trader_historical_simulation_atomic_stage_v2
  ADD CONSTRAINT historical_sim_atomic_stage_kind CHECK (stage IN
    ('FORECAST_LIFECYCLE','CANONICAL_VERIFICATION','MODELED_RISK','MODELED_EXECUTION',
     'OBSERVED_EXECUTION_EFFECTS','HISTORICAL_MODELED_REALITY','ACCOUNTING','GUARDIAN','KNOWLEDGE','LEARNING'));
