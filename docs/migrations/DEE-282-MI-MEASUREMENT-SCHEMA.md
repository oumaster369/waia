# DEE-282 — Market Intelligence Measurement / Feature Registry schema

**Linear:** DEE-282 (LD-3)  
**Risk tier:** T2 (additive schema, org-scoped, RLS)  
**Doctrine:** `docs/ai-trader/AI-TRADER-MARKET-INTELLIGENCE-ARCHITECTURE.md` (Accepted)

## Summary

Adds Layer-2 Market Intelligence **Measurement / Feature Registry** — an append-only registry of **versioned transform definitions** over observations:

| Table | Mutability | Purpose |
|-------|------------|---------|
| `trader_mi_measurement` | **Append-only** | Org-scoped versioned transform-definition registry with deterministic `measurement_key`, reproducible `definition_digest`, and append-only version chain |

The registry stores **definitions only** — never computed values (those are PIT Observations / `FeatureSnapshot`). No execution engine, no runtime binding.

## Migrations

| Backend | File | Purpose |
|---------|------|---------|
| SQLite | `db/migrations/0017_trader_mi_measurement.sql` | Table, indexes, append-only triggers |
| Postgres | `db/migrations_postgres/0022_trader_mi_measurement.sql` | Enum `mi_measurement_kind`, table, indexes, mutation-block triggers |
| Postgres | `db/migrations_postgres/0023_trader_mi_measurement_rls.sql` | RLS deny `authenticated`/`anon` |

## Invariants (locked — M1–M7)

- **Object architecture (M1):** versioned transform DEFINITION, never a computed value; no value/output column.
- **Deterministic identity (M2):** `measurement_key = sha256(canonicalJson({ organizationId, measurementKind, name }))` — stable logical family key, independent of the definition body.
- **Reproducible digest (M3):** canonical JSON + SHA-256 over `{ schemaVersion, organizationId, measurementKey, measurementKind, name, definitionCanonical }`; excludes `id`, `created_at`, `version_seq`, `revision_of`, `definition_digest`, wall-clock fields; numeric params normalized to fixed-precision decimal strings.
- **No PIT pair / no source (M4):** definitions carry `authored_by` + `created_at` only — no `event_time`/`ingest_time`, no `source_id`.
- **Append-only version chain (M5):** `version_seq` monotonic per `(organization_id, measurement_key)`; `revision_of` composite self-FK; new version only when `definition_digest` differs; identical re-registration rejected; current = max `version_seq`.
- **Declarative lineage (M6):** definitions declare input observation kinds inside `definition_json`; validated non-empty + against known `mi_observation_kind`; no row-level FK to observations.
- **Inert registry (M7):** `definition_json` is declarative metadata with no evaluator; no runtime wiring; Feature Engine and `runEvaluationCycle` untouched.
- **Tenant isolation:** `organization_id` on all rows; composite FKs; Postgres RLS deny `authenticated`/`anon`; release-blocking `*tenant-isolation*` tests.

## Digest contract — `MEASUREMENT_PARAM_PRECISION = 8` (locked)

`definition_digest` (M3) normalizes **every** numeric value in the definition to a fixed-precision decimal string via `Number#toFixed(8)` before canonical JSON + SHA-256 (`lib/trader/mi/serialize-measurement.ts` → `MEASUREMENT_PARAM_PRECISION`). This constant is **part of the digest contract**, not an implementation detail:

- **Changing the precision changes digest semantics.** The same authored definition would hash to a different `definition_digest`, breaking reproducibility and any future LD-5 Evidence pin (`evidence pins a version`).
- **It is rounding to 8 decimal places.** Numeric parameters that differ only beyond `1e-8` collide to the same digest by design; authored params must stay within this resolution.
- **Treat as an immutable contract once any row exists.** A future change to the precision (or the normalization scheme) is a **schema-version evolution** — it requires bumping `MI_MEASUREMENT_SCHEMA_VERSION` (and a migration/backfill strategy), never an in-place edit of the constant.
- **`definition_digest` is not `sha256(definition_json)`.** `definition_json` is stored as authored (raw); the digest is derived from the canonicalized + normalized form plus the envelope fields. Re-derive only via `buildMeasurementDigestFromDefinition`.

## Rollback

Additive only. Rollback = drop triggers/policies/function then drop table and enum (no existing table modified).

## Validation

```bash
pnpm db:migrate && pnpm test --run tests/unit/trader-mi-measurement.test.ts tests/unit/trader-mi-measurement-tenant-isolation.test.ts
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
