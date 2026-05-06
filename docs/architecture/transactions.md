# WAIA Transaction Architecture Contract (DEE-64 D3)

Status: contract-only slice. No runtime code, types, or Postgres placeholders are introduced by D3. SQLite remains the only active runtime; D1+D2 already centralized transaction entrypoints behind `runWaiaSqliteLegacyTransaction` in `db/waia-transaction.ts`.

This document is the source of truth for transaction semantics, divergences between SQLite and Postgres, and the sequencing that future slices must follow.

## 1. Current state (post-D2)

```
runtime callers
    -> runWaiaSqliteLegacyTransaction   (db/waia-transaction.ts)
        -> runSqliteTransaction         (db/types.ts)
            -> better-sqlite3 db.transaction (sync)
```

- SQLite-only handle: `WaiaDb = BetterSQLite3Database<typeof WaiaSQLiteSchema>` in `db/types.ts`.
- Five migrated callers: `lib/oauth/oauth-callback.ts`, `app/api/auth/sign-up/route.ts`, `app/api/auth/sign-in/route.ts`, `lib/twin-persistence/loader.ts`, `lib/twin-persistence/diary-memory.ts`.
- Runtime resolver `getWaiaRuntimeDb` (`db/waia-runtime-db.ts`) returns a discriminated `WaiaRuntimeDb` but is consumed only by `app/api/health/database/route.ts`. It is intentionally not bound to the transaction layer.
- Postgres Drizzle singleton (`db/postgres-client.ts`) and parallel schema (`db/schema.postgres.ts`) support **DEE-72.1** twin/diary persistence in **`lib/persistence/postgres/*`** (async writes via **`runWaiaPostgresTransaction`**). This is **not** production route migration; SQLite remains authoritative for default production.

## 2. Architectural constraints

These constraints define the honest boundary between what is supportable today and what would be a fake abstraction.

- SQLite is sync. `better-sqlite3`'s `db.transaction(cb)` runs the callback synchronously; awaiting async I/O inside is outside the transaction boundary. The current `runSqliteTransaction` wraps that sync result in `Promise.resolve(...)` purely to fit `await`-shaped routes.
- Postgres is async. `drizzle-orm/postgres-js` `db.transaction(async cb)` accepts a Promise-returning callback; rollback is driven by awaited rejection.
- Type divergence. `WaiaDb` (SQLite Drizzle) and `PostgresJsDatabase<typeof pgSchema>` are structurally different; their `.select/.insert/.update` types depend on different schema modules (`db/schema.ts` vs `db/schema.postgres.ts`).
- Schema duality. Persistence helpers (`twin-persistence/*`, `oauth-user-session.ts`, `auth/session-service.ts`) reference SQLite schema tables. They cannot transparently run against a Postgres `tx` without backend-specific repositories.
- Sync helpers inside tx. `ensureUserTwinSeed`, `createSessionRow`, `appendTwinDialogueTurnInsideExecutor`, etc., are deliberately synchronous so they remain valid inside the SQLite transaction. Promoting them to async would break SQLite semantics.
- Runtime initialization gap. `getWaiaRuntimeDb()` is async and currently used only at the request boundary; persistence call sites still depend on the sync `getDb()` shape.
- Transaction entrypoints are centralized (D1+D2). D3b adds `WaiaSqliteTransactionCallback<T>` as the explicit SQLite-only transaction body type; no cross-backend or async callback contract exists yet.
- Pragma assumptions. `journal_mode = WAL` and `foreign_keys = ON` in `db/client.ts` are SQLite-specific and must not be silently assumed by runtime-aware code.
- Honest abstraction line. Until Postgres has migrations applied in-app, repositories on `schema.postgres`, RLS policy, and verified rollback semantics, any unified transaction runner would either silently degrade Postgres or pretend Postgres exists.

## 3. Sequenced roadmap (slices after D3)

D3 ships only this contract. The following sequence is the ratified plan; each slice must respect the acceptance bar in section 4.

### D3b - Types-only contract reinforcement
- Co-locate a single SQLite-shaped callback alias `WaiaSqliteTransactionCallback<T> = (tx: WaiaDb) => T` in `db/waia-transaction.ts`.
- JSDoc updates that name `runWaiaSqliteLegacyTransaction` and the callback type as the explicit SQLite legacy branch (not portable to Postgres).
- No new runtime functions. No async callback type. No new tests beyond type assertions.

### D4 - Runtime-handle seam, SQLite-only guardrail (implemented)
- `runWaiaTransactionOnRuntime(handle: WaiaRuntimeDb, fn: WaiaSqliteTransactionCallback<T>)` lives in `db/waia-transaction.ts`.
- Behavior:
  - `kind: "sqlite"` -> delegate to `runWaiaSqliteLegacyTransaction(handle.db, fn)`.
  - `kind: "postgres"` -> reject the returned `Promise` with a fixed `[waia]` error (Postgres transactions are not yet supported); **`fn` is never invoked**.
- No call site migration. The existing 5 callers continue to use `runWaiaSqliteLegacyTransaction` directly.
- Unit tests in `tests/unit/waia-transaction.test.ts` cover the Postgres rejection path and SQLite delegation.

### D5a - SQLite persistence boundary (additive; production callers unchanged)

- `lib/persistence/sqlite/*` exposes `createSqliteTwinPersistence(db: WaiaDb)` — delegates to existing twin/diary modules; transaction policy stays in `db/waia-transaction.ts`.
- `lib/persistence/runtime.ts` exposes `resolveTwinPersistence(handle: WaiaRuntimeDb)` with typed overloads — SQLite returns the SQLite boundary; **DEE-72.1** returns the Postgres boundary for `kind: "postgres"` (explicit handle `db` only).
- No `runWaiaTransactionOnRuntime` requirement for persistence; resolution is separate from transaction orchestration.

### D5+ - Backend-specific persistence repositories
- Introduce SQLite and Postgres repositories with async-aware helpers, parameterized over the active schema module.
- Migrate callers to runtime handles only on paths where Postgres semantics are validated end-to-end (including rollback).
- Existing sync SQLite helpers remain valid for the SQLite path.

### D6-pre - Postgres foundation (infrastructure only; implemented)

- **Goal:** repeatable local/CI Postgres bootstrap + migration apply + opt-in integration tests **before** any real Postgres transaction runner exists.
- Deliverables: [`docs/postgres-development.md`](../postgres-development.md), `pnpm db:postgres:*` scripts, optional `WAIA_PG_INTEGRATION=1` tests under `tests/integration/`, manual [`postgres-integration`](../.github/workflows/postgres-integration.yml) workflow.
- **Non-goals:** `runWaiaPostgresTransaction`, routing `runWaiaTransactionOnRuntime` for Postgres, production caller migration, SQLite changes.

### D6-core - Genuine Postgres transaction runner (implemented)

- Added [`db/waia-postgres-transaction.ts`](../../db/waia-postgres-transaction.ts): `runWaiaPostgresTransaction(db, fn)` where `db` is explicit `PostgresJsDatabase<typeof pgSchema>` and `fn` is `WaiaPostgresTransactionCallback<T>` (async-only, schema-bound via Drizzle `Parameters` extraction).
- Rollback validated via opt-in [`tests/integration/postgres-transaction-rollback.test.ts`](../../tests/integration/postgres-transaction-rollback.test.ts) (commit/throw/reject; separate-session reads).
- **Still no:** `runWaiaTransactionOnRuntime` Postgres routing, `runWaiaTransaction`, production caller migration.

### DEE-72.1 — Postgres twin/diary persistence boundary (implemented)

- **`PostgresTwinPersistence`** / **`createPostgresTwinPersistence(db)`** in `lib/persistence/postgres/twin-persistence.ts` (and optional `index.ts` barrel). Method surface aligns with **`SqliteTwinPersistence`** (D5a); Postgres methods are **async** and **writes** use **`runWaiaPostgresTransaction`** only (no `runWaiaSqliteLegacyTransaction`, no shared callback type with SQLite).
- **`resolveTwinPersistence`** (`lib/persistence/runtime.ts`) uses typed overloads: SQLite → SQLite boundary; Postgres → Postgres boundary. **Explicit `db` on the handle** — no hidden singleton in the resolver.
- **Non-goals for this slice:** neutral `runWaiaTransaction`, production route migration, **`lib/reasoning/*`** on Postgres, repeatability / prediction / memory-search Postgres support, backend-neutral repositories.

### D6 (remainder after D6-core)

- Optional: route `runWaiaTransactionOnRuntime` Postgres branch (separate slice; requires explicit approval).
- A neutral `runWaiaTransaction` name is reserved for **after** both backends have validated semantics and an explicit caller migration policy exists; introducing it earlier would lie about what is supported.

## 4. Acceptance bar for future slices

Any slice that touches the transaction layer must satisfy all of the following until Postgres support is genuinely complete:

- Any new runtime function that accepts `WaiaRuntimeDb` MUST reject (return a rejected Promise) or throw on `kind: "postgres"` until D6 wires it — and MUST NOT invoke a SQLite-shaped callback on that branch.
- New tests MUST assert the explicit Postgres-throw behavior whenever a runtime-handle entrypoint is added.
- New type aliases for transaction callbacks MUST be SQLite-shaped (`(tx: WaiaDb) => T`) until async persistence exists.
- The pre-existing cast `tx as WaiaDb` inside `runSqliteTransaction` is acknowledged debt and must not be conflated with abstraction work.
- `db/client.ts`, `getDb()`, `db/runtime-backend.ts`, and `db/postgres-client.ts` remain untouched by transaction-layer slices.
- A neutral name like `runWaiaTransaction` MUST NOT be introduced before D6; the SQLite branch keeps the explicit `Sqlite` suffix.

## 5. Invariant grep checks

TypeScript / TSX only (`--glob "*.{ts,tsx}"`):

- `runSqliteTransaction\(` -> only `db/waia-transaction.ts` (delegate). Definition in `db/types.ts` uses `<` and is excluded from this regex.
- `runWaiaSqliteLegacyTransaction\(` -> only the five migrated call sites and the facade definition in `db/waia-transaction.ts`, plus internal use from `runWaiaTransactionOnRuntime`.
- `runWaiaTransaction\b` -> no matches.
- `runWaiaTransactionOnRuntime\b` -> only `db/waia-transaction.ts` and `tests/unit/waia-transaction.test.ts`.
- `runWaiaPostgresTransaction\b` -> `db/waia-postgres-transaction.ts`, `lib/persistence/postgres/**/*.ts`, and `tests/integration/*.test.ts` (opt-in Postgres integration tests only).
- `WaiaPostgresTransactionCallback\b` -> only `db/waia-postgres-transaction.ts`.
- `WaiaRuntimeDb` -> `db/waia-runtime-db.ts`, `db/waia-transaction.ts` (type import / parameter), `lib/persistence/runtime.ts` (D5a / DEE-72.1 persistence resolution), `app/api/health/database/route.ts`, `tests/unit/waia-runtime-db.test.ts`, `tests/unit/health-database-route.test.ts`, `tests/unit/waia-transaction.test.ts`, `tests/unit/sqlite-twin-persistence-boundary.test.ts`, `tests/integration/postgres-twin-persistence.test.ts` (opt-in).

## 6. Rollback

- D3 introduces no source code, only this document. Rollback is a single revert of the docs commit.
- The ratified contract continues to apply even if this file is reverted; future slices must still respect the constraints in section 2 and the sequencing in section 3.
