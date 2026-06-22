# DEE-281 — Market Intelligence PIT Observation schema

**Linear:** DEE-281 (LD-2b)  
**Risk tier:** T2 (additive schema, org-scoped, RLS)  
**Doctrine:** `docs/ai-trader/AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md` (Accepted)

## Summary

Adds Layer-1 Market Intelligence **PIT Observation** persistence with MSV envelope recording:

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_observation` | **Append-only** | Org-scoped PIT observations with deterministic `observation_key`, revision chain, reproducible `content_digest`, mandatory `source_id` |

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0016_trader_mi_observation.sql` | Table, indexes, append-only triggers |
| Postgres | `db/migrations_postgres/0020_trader_mi_observation.sql` | Enum `mi_observation_kind`, table, indexes, mutation-block triggers |
| Postgres | `db/migrations_postgres/0021_trader_mi_observation_rls.sql` | RLS deny `authenticated`/`anon` |

## Invariants (locked — hardened R1–R5)

- **Deterministic identity (R1):** `observation_key = sha256(canonicalJson({ organizationId, sourceId, observationKind, subjectRef, eventTime }))`; `msvId` / `featureSetId` are correlation metadata only.
- **Reproducible digest (R2):** canonical JSON + SHA-256 over `{ schemaVersion, organizationId, sourceId, observationKey, observationKind, subjectRef, eventTime, payloadCanonical }`; excludes random ids, ingest/revision metadata, wall-clock fields; `payloadCanonical` strips `msvId`/`featureSetId` and normalizes `derived.dataQualityScore`.
- **Provenance (R3):** `source_id NOT NULL`; MSV writes resolve/seed dedicated internal source via LD-2a service.
- **PIT (R4):** `event_time` = market-knowable time; `ingest_time` = recorded; `ingest_time >= event_time` enforced in service layer.
- **Revision chain:** `revision_seq` monotonic per `(organization_id, observation_key)`; `revision_of` composite self-FK.
- **Fail-open (R5):** `recordMsvObservationSafe` is side-effect only; own DB handle/transaction; no trading-path coupling.
- **Tenant isolation:** `organization_id` on all rows; composite FKs; release-blocking `*tenant-isolation*` tests.

## Rollback

Additive only. Rollback = drop triggers/policies/function then drop table (no existing table modified).

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-observation.test.ts tests/unit/trader-mi-observation-tenant-isolation.test.ts
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
