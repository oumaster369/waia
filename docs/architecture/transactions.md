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
- Postgres Drizzle singleton (`db/postgres-client.ts`) and parallel schema (`db/schema.postgres.ts`) exist but are not wired to persistence.

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

### D4 - Runtime-handle seam, SQLite-only guardrail
- Add `runWaiaTransactionOnRuntime(handle: WaiaRuntimeDb, fn): Promise<T>`.
- Behavior:
  - `kind: "sqlite"` -> delegate to `runWaiaSqliteLegacyTransaction(handle.db, fn)`.
  - `kind: "postgres"` -> throw an explicit, named error (Postgres transactions are not yet supported).
- No call site migration. The existing 5 callers continue to use `runWaiaSqliteLegacyTransaction` directly.
- New tests assert the explicit-throw on the Postgres branch.

### D5+ - Backend-specific persistence repositories
- Introduce SQLite and Postgres repositories with async-aware helpers, parameterized over the active schema module.
- Migrate callers to runtime handles only on paths where Postgres semantics are validated end-to-end (including rollback).
- Existing sync SQLite helpers remain valid for the SQLite path.

### D6 - Genuine Postgres transaction runner
- Add `runWaiaPostgresTransaction(db, async fn)` once schema-bound persistence on `schema.postgres.ts` exists and rollback is verified.
- Only at this point does `runWaiaTransactionOnRuntime` route on backend instead of throwing on Postgres.
- A neutral `runWaiaTransaction` name is reserved for this slice or later; introducing it earlier would lie about what is supported.

## 4. Acceptance bar for future slices

Any slice that touches the transaction layer must satisfy all of the following until Postgres support is genuinely complete:

- Any new runtime function that accepts `WaiaRuntimeDb` MUST throw on `kind: "postgres"` until D6 wires it.
- New tests MUST assert the explicit Postgres-throw behavior whenever a runtime-handle entrypoint is added.
- New type aliases for transaction callbacks MUST be SQLite-shaped (`(tx: WaiaDb) => T`) until async persistence exists.
- The pre-existing cast `tx as WaiaDb` inside `runSqliteTransaction` is acknowledged debt and must not be conflated with abstraction work.
- `db/client.ts`, `getDb()`, `db/runtime-backend.ts`, and `db/postgres-client.ts` remain untouched by transaction-layer slices.
- A neutral name like `runWaiaTransaction` MUST NOT be introduced before D6; the SQLite branch keeps the explicit `Sqlite` suffix.

## 5. Invariant grep checks

These checks should remain stable until D4 lands. They form the ratification baseline.

- `runSqliteTransaction\(` -> only `db/waia-transaction.ts` (delegate). Definition in `db/types.ts` uses `<` and is excluded from this regex.
- `runWaiaSqliteLegacyTransaction\(` -> only the five migrated call sites and the facade definition.
- `runWaiaTransaction\b` -> no matches.
- `WaiaRuntimeDb` -> only `db/waia-runtime-db.ts`, `app/api/health/database/route.ts`, `tests/unit/waia-runtime-db.test.ts`, `tests/unit/health-database-route.test.ts`.

## 6. Rollback

- D3 introduces no source code, only this document. Rollback is a single revert of the docs commit.
- The ratified contract continues to apply even if this file is reverted; future slices must still respect the constraints in section 2 and the sequencing in section 3.
