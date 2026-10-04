-- LOCAL VALIDATION DRAFT ONLY. Not a canonical production migration.
-- 0229 is applied and immutable. Numbering must be coordinated with deferred
-- PR759/0230 before this additive proposal enters the migration journal.
-- No classifier or existing read-purpose gate changes. These two metadata
-- grants permit an exact version/config check in the same pre-decryption query.
--> statement-breakpoint
GRANT SELECT (observation_revision)
  ON public.exchange_credentials TO waia_account_observation_credential;
--> statement-breakpoint
GRANT SELECT (configuration_revision)
  ON public.trader_account_collection_state TO waia_account_observation_credential;
