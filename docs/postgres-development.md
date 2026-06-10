# Postgres development and testing (DEE-64 D6-pre)

This document defines how WAIA’s **Postgres** side (parallel to SQLite) is bootstrapped for **local development**, **migrations**, and **optional integration tests**. **D6-core** added `runWaiaPostgresTransaction`; **DEE-72.1** adds an explicit **Postgres twin/diary persistence boundary** (`PostgresTwinPersistence` / `createPostgresTwinPersistence`). **DEE-72.2** extends that boundary with **twin prediction verifications** (`appendTwinPredictionVerificationForUser`, `listTwinPredictionVerificationsForUser` on `PostgresTwinPersistence`), still without production route migration. **DEE-72.3** adds **read-only twin memory retrieval** (`searchTwinMemoriesByText` on `PostgresTwinPersistence`): full-table candidate load + JS cosine scoring to mirror SQLite MVP behavior — **no pgvector**, **no SQL-side similarity**, **no production route migration**. **DEE-72.4** adds **reasoning-local memory + verification ports** (`lib/reasoning/twin-reasoning-ports.ts`) so non-route code can compose **`PostgresTwinPersistence`** with **`runTwinContradictionDetectorForUserAsync`**, **`getTwinPatternSummaryForUserAsync`**, and **`runTwinPredictionForUserAsync`** — **`runTwinEngine` and API routes remain SQLite-first**. **DEE-72.4b** adds opt-in integration tests in **`tests/integration/postgres-twin-reasoning-prediction.test.ts`** (async prediction + pattern summary on Postgres **without** opening SQLite). **DEE-72.5** adds **repeatability** append + aggregate analyze on **`PostgresTwinPersistence`** and **`analyzeRepeatabilityForUserAsync`**; prediction for repeatability append runs **outside** the Postgres transaction (no reasoning inside `runWaiaPostgresTransaction` callbacks). **DEE-72.6** adds **`runTwinEnginePostgresAsync`** (`lib/reasoning/twin-engine-postgres.ts`): full **async twin engine orchestration** on Postgres, mirroring sync **`runTwinEngine`** step order only — **no** dashboard **`/api/dashboard/twin/engine`** wiring, **no** `runWaiaTransaction`, **no** `runtime.ts` backend switching, **no** required string parity with SQLite. **Production routing remains SQLite-first**; no production route migration ships in **DEE-72.1** through **DEE-72.6**.

## Honest current state

| Area | Status |
|------|--------|
| Drizzle schema | [`db/schema.postgres.ts`](../db/schema.postgres.ts) — source of truth for **types and generator input**. |
| SQL migrations | [`db/migrations_postgres/`](../db/migrations_postgres/) — **authoritative apply target** for shared environments (Drizzle Kit `migrate`). |
| `drizzle-kit push` | **Not** the team workflow for canonical schema. `push` mutates a DB without leaving versioned SQL in-repo; use only for personal experiments and **do not** treat pushed DBs as reproducible. |
| Production app | Still **SQLite** by default (`DATABASE_URL`, `getDb()`). **`resolveTwinPersistence`** can return **`PostgresTwinPersistence`** when the caller supplies a Postgres `WaiaRuntimeDb` handle (DEE-72.1); that does **not** switch production routes. `WAIA_DB_BACKEND=postgres` remains **not** a supported end-user production path until a later slice. |
| Transactions | **D6-core:** [`db/waia-postgres-transaction.ts`](../db/waia-postgres-transaction.ts) provides `runWaiaPostgresTransaction` with async semantics. **Explicit backend-specific API only** — no production runtime routing yet. SQLite semantics unchanged. |
| RLS / Supabase `auth` | [`schema.postgres.ts`](../db/schema.postgres.ts) documents gaps. Migrations include stubs for local CI only. |

If generated migrations drift from `schema.postgres.ts`, **document the gap** and regenerate with `pnpm db:generate:postgres` before merging (review SQL by hand).

## Migration policy

1. **Edits** to the logical schema happen in [`db/schema.postgres.ts`](../db/schema.postgres.ts).
2. **Versioned SQL** is produced with Drizzle Kit:
   - `pnpm db:generate:postgres`  
   - Config: [`drizzle.postgres.config.ts`](../drizzle.postgres.config.ts) → output [`db/migrations_postgres`](../db/migrations_postgres/).
3. **Apply** migrations to a target database:
   - `pnpm db:migrate:postgres` — reads `DATABASE_URL_POSTGRES` from `.env.local` (same as `pnpm dev`) when not exported in the shell
   - `DATABASE_URL_POSTGRES=<url> pnpm db:migrate:postgres` — optional override for CI or one-off targets
4. **Auth stub for Docker / empty Postgres**: migrations reference `auth.users` for FK alignment with future Supabase. Bare Postgres has no `auth` schema; apply the prelude **before** first migrate (or after wiping DB):
   - `pnpm db:postgres:auth-prelude`

The prelude **duplicates** [`scripts/postgres-validation/prelude-auth-stub.sql`](../scripts/postgres-validation/prelude-auth-stub.sql); keep them aligned.

## Local Postgres (Docker)

Compose file: [`docker-compose.postgres-validate.yml`](../docker-compose.postgres-validate.yml) (Postgres 16, port **54329**).

```bash
# Start and wait for healthcheck
pnpm db:postgres:up

# Put the Docker URL in `.env.local` (or export for this shell only):
# DATABASE_URL_POSTGRES=postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate

# One-time per empty database (auth stub), then apply migrations
pnpm db:postgres:auth-prelude
pnpm db:migrate:postgres

# Optional: driver + Drizzle smoke (insert/select against public.users + auth.users)
pnpm db:smoke:postgres
```

Tear down:

```bash
pnpm db:postgres:down
```

**Reset flow** (destructive): `docker compose -f docker-compose.postgres-validate.yml down -v`, then `up`, prelude, migrate again.

## Integration-test strategy

- **Default `pnpm test` / CI unit job**: SQLite only; **no** Postgres required.
- **Opt-in Postgres tests**: set `WAIA_PG_INTEGRATION=1` and a valid `DATABASE_URL_POSTGRES`. Tests live under [`tests/integration/`](../tests/integration/).
- **D6-core rollback validation**: [`postgres-transaction-rollback.test.ts`](../tests/integration/postgres-transaction-rollback.test.ts) proves commit/throw/reject semantics using **separate raw postgres sessions** for reads. **No claim of SQLite/Postgres parity**.
- **DEE-72.1 / DEE-72.2 / DEE-72.3 / DEE-72.5 twin/diary/verifications/memory/repeatability persistence**: [`postgres-twin-persistence.test.ts`](../tests/integration/postgres-twin-persistence.test.ts) exercises **`PostgresTwinPersistence`** (dialogue, diary, scenario, prediction verifications append/list, **read-only memory search**, **repeatability** append + analyze, chronological reads, readiness load, rollback). Same **opt-in** gate (`WAIA_PG_INTEGRATION=1` + `DATABASE_URL_POSTGRES`). **Does not** test production runtime routing.
- **DEE-72.4b async reasoning on Postgres**: [`postgres-twin-reasoning-prediction.test.ts`](../tests/integration/postgres-twin-reasoning-prediction.test.ts) exercises **`createTwinMemorySearchPortPostgres`** with **`runTwinPredictionForUserAsync`** and **`getTwinPatternSummaryForUserAsync`** (no SQLite `getDb()`). Same opt-in gate; **does not** claim SQLite/Postgres parity.
- **DEE-72.6 Postgres async twin engine**: [`postgres-twin-engine.test.ts`](../tests/integration/postgres-twin-engine.test.ts) exercises **`runTwinEnginePostgresAsync`** for response shape, **`modulesRun`**, and prediction null rules (opt-in; **structural** assertions only).
- **DEE-105 (Linear) Postgres coherence slice** (DEE-95D §14 / DEE-95E §11–§14): [`postgres-runtime-coherence.test.ts`](../tests/integration/postgres-runtime-coherence.test.ts) chains **append prediction verification → list verifications → analyze repeatability → `runTwinEnginePostgresAsync`** on a **single** **`PostgresTwinPersistence`** / `DATABASE_URL_POSTGRES` boundary. Same opt-in gate; **does not** invoke HTTP routes or change `WAIA_DB_BACKEND` defaults; **no required CI job** for Postgres.
- **CI**: optional workflow [`.github/workflows/postgres-integration.yml`](../.github/workflows/postgres-integration.yml) runs on `workflow_dispatch` (manual) so Postgres does not slow every PR until you promote it.

### Run DEE-105 coherence test locally

Prerequisites: local Postgres with WAIA migrations applied (see [Local Postgres (Docker)](#local-postgres-docker) above).

```bash
export DATABASE_URL_POSTGRES='postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate'
export WAIA_PG_INTEGRATION=1
pnpm test -- tests/integration/postgres-runtime-coherence.test.ts --run
```

Unset `WAIA_PG_INTEGRATION` (or leave it unset) to confirm the default suite skips this file without requiring Postgres.

## Security and environment hygiene

- Scripts that mutate data (`db:smoke:postgres`, `db:postgres:auth-prelude`) **must** target **local** hosts only (same guard pattern as [`scripts/postgres-validation/drizzle-pg-smoke.ts`](../scripts/postgres-validation/drizzle-pg-smoke.ts)).
- Never point smoke scripts at production-like hosts.

## Related docs

- [DEE-64 tracker](migrations/DEE-64-TRACKER.md)
- [Transaction architecture](architecture/transactions.md) — SQLite vs Postgres semantics; D6-core transaction work
