-- DEE-1083: avoid repeatedly detoasting the complete observation history for
-- latest complete balances and first successful connection. Exact existing
-- predicates and immutable evidence are preserved. No grants/RLS/write rules.
CREATE INDEX IF NOT EXISTS trader_observation_balance_lookup
  ON public.trader_account_observations
  (organization_id, exchange_account_id, recorded_at, observation_id, credential_id)
  WHERE payload->'balances'->>'status' = 'COMPLETE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trader_observation_success_lookup
  ON public.trader_account_observations
  (organization_id, exchange_account_id, recorded_at, observation_id, credential_id)
  WHERE payload->>'status' = 'COMPLETE' AND payload->'balances'->>'status' = 'COMPLETE';
