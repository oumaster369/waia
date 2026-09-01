-- Internal Guardian V2 and Runtime Authority V2 evidence/control relations are
-- service-owned. RLS policies do not protect TRUNCATE, REFERENCES, or TRIGGER,
-- so remove every table privilege from all browser/public principals.
REVOKE ALL PRIVILEGES ON TABLE
  public.trader_guardian_assessments_v2,
  public.trader_guardian_protective_consumptions_v2,
  public.trader_runtime_authority_assessments_v2,
  public.trader_runtime_control_lease_heads_v2,
  public.trader_runtime_control_lease_epoch_history_v2
FROM PUBLIC, anon, authenticated;
