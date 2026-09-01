# 0189 — Historical Forecast V2 PIT persistence design

Status: design and code-only fail-closed hardening. Migration number and journal are intentionally untouched while 0188 is in progress.

## Audit

### P1 blockers before production composition

1. `trader_historical_forecast_input_pit_v2` has no migration yet. The current producer/loader cannot be a production persistence boundary until 0189 creates it.
2. Forecast issuance persists the authorized outcome but not the exact `ForecastRuntimeInputV2` in the same issuance transaction. A post-hoc caller can therefore supply a replayable input without proving that it was the input actually used at issuance.
3. The PIT producer reads several sources and inserts the PIT row without one `SERIALIZABLE` transaction or source locks. Source validation and commitment can race.
4. The future loader validates the PIT envelope and replays Forecast V2, but does not reload every canonical source row and compare its exact digest/identity.
5. No database foreign keys currently bind the PIT row to run start, the durable dataset authority, Forecast member/bundle, scientific admission, contract binding, predictive package, market snapshot/admission source, or the visible knowledge closure.

### P2 hardening

1. Persist exact source IDs and semantic digests as columns, not only nested JSON.
2. Bind the verifier to the immutable deployment/source SHA and reject disagreeing SHA authorities.
3. Use append-only triggers, owner-only RLS, explicit client revocation, and retention-safe indexes.
4. Prove idempotency, concurrency, source substitution, future visibility, cross-run/tenant/cycle splicing, reordered JSON keys, and verifier upgrade behavior in fresh PostgreSQL.

## Canonical producer-owned source

Add `trader_forecast_runtime_input_source_v2`, written inside the existing Forecast issuance transaction. `PersistForecastBundleV2Input` must carry the exact `ForecastRuntimeInputV2`; the persistence service must replay it, require equality with `authorizedOutcome`, and insert the immutable source row atomically with the bundle and both Forecast members.

Identity:

- `(organization_id, bundle_id, run_id, cycle_id, symbol, pit_anchor)`
- exact runtime-input semantic digest
- predictive admission digest
- market snapshot digest
- contract-binding digest
- predictive-package ID/content digest
- scientific-admission receipt ID/content digest
- knowledge edge ID/content digest
- immutable verifier build digest

The row has composite tenant-scoped FKs to the Forecast bundle/package and canonical scientific/binding sources. Any market snapshot or predictive admission object lacking its own durable source must receive a producer-owned immutable source table in 0189; it must not be reconstructed from caller JSON.

## PIT row

Add `trader_historical_forecast_input_pit_v2` with a primary identity covering organization, run, cycle, Forecast, dataset authority, PIT, knowledge digest, and Forecast authority digest. Store the exact runtime-input-source ID and dataset-authority ID. Add composite FKs to:

- `trader_historical_simulation_run_start_v2` on organization/run;
- `trader_historical_dataset_authority_v2` on ID/organization/run/cycle/dataset seal;
- `trader_forecast_runtime_input_source_v2` on tenant/bundle/run/cycle/PIT;
- `trader_forecast_v2` and `trader_forecast_bundle_v2`;
- the scientific admission, contract binding, and predictive package source identities.

The producer transaction performs: lock run boundary → load dataset authority → load runtime-input source → replay Forecast V2 → reload and validate scientific/binding/package sources → load only same-run knowledge rows visible by the market PIT → recompute knowledge closure → insert PIT row → exact read-back. No `latest` query and no caller-supplied evidence JSON are allowed.

## Loader

The loader accepts only scalar exact identity plus dataset-authority ID. It loads exactly one PIT row, then reloads every referenced source and recomputes:

- dataset membership and sealed-cycle authority;
- runtime input source digest;
- scientific admission validation;
- Forecast schema/member digest and full authorized outcome;
- temporal knowledge closure;
- PIT envelope digest and Forecast authority replay.

Any absence, ambiguity, source mutation, build mismatch, or future-created source fails closed.

## Fresh-PostgreSQL matrix

Apply literal migrations `0000..0189` to a new PostgreSQL 16 database, then verify:

- all composite FKs and JSON/column checks;
- append-only update/delete rejection;
- authenticated/anon denial and explicit owner-service posture;
- positive two-cycle run where cycle N cannot see outcome from N until its future visibility point;
- wrong tenant/run/cycle/dataset/Forecast/package/scientific/knowledge source rejection;
- concurrent duplicate producer calls converge to one identical row;
- conflicting duplicate and reordered/substituted JSON fail or compare canonically as appropriate;
- exact reload after restart reproduces the same Forecast authority digest.

Estimated implementation after 0188 frees the journal: 2–4 hours for migration, issuance-transaction integration, repository/loader, and the fresh-PostgreSQL matrix, assuming no additional durable market-snapshot schema is required.
