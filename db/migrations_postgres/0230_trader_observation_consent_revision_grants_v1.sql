-- DEE-1231: metadata reads for exact existing-key observation consent fences.
-- Human coordinated this slot on 2026-10-04; deferred inventory moves to 0231.
-- No new ciphertext privilege, writes, permissions classifier or execution route.
GRANT SELECT (observation_revision)
  ON public.exchange_credentials TO waia_account_observation_credential;
--> statement-breakpoint
GRANT SELECT (configuration_revision)
  ON public.trader_account_collection_state TO waia_account_observation_credential;
