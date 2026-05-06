# DEE-64 Internal Slice Tracker

## Purpose

DEE-64 is not merely “replace SQLite client”. It is a **staged migration** to disentangle SQLite-specific assumptions from WAIA’s runtime and persistence architecture, while keeping production behavior honest until Postgres-backed paths are genuinely supported (async transactions, rollback, schema-bound repositories).

This tracker records **what shipped**, **what must not regress**, and **what remains** so future agents and contributors do not collapse the program into fake backend-neutral abstractions or premature SQLite removal.

## Current Status

**D1, D2, D3, D3b, D4, D5a, and D6-pre are complete and merged** on `dev`.

**D6-core** adds **explicit Postgres transaction runner** (`db/waia-postgres-transaction.ts`, async-only callback, rollback integration tests). **Still no** `runWaiaTransaction`, **still no** production runtime routing, **still no** caller migration.

## Completed Slices

### D1

- Introduced `db/waia-transaction.ts`
- Added `runWaiaSqliteLegacyTransaction`
- Delegates to `runSqliteTransaction`
- No runtime behavior change

### D2

- Migrated production runtime transaction callers to `runWaiaSqliteLegacyTransaction`
- Removed direct runtime caller dependency on `runSqliteTransaction`
- No caller behavior change

### D3

- Added `docs/architecture/transactions.md`
- Ratified transaction architecture contract
- No code/runtime/type changes

### D3b

- Added `WaiaSqliteTransactionCallback<T>`
- Clarified SQLite-only synchronous callback semantics
- Aligned transaction docs
- No runtime behavior change

### D4

- Added `runWaiaTransactionOnRuntime`
- SQLite branch delegates to legacy facade
- Postgres branch rejects explicitly (`Promise.reject` with a stable `[waia]` message; callback is never invoked)
- No production callers migrated

### D5a

- Added `lib/persistence/sqlite/twin-persistence.ts` with `createSqliteTwinPersistence(db)` delegating to `lib/twin-persistence/*` (no behavior change; explicit SQLite naming).
- Added guarded `resolveTwinPersistence(handle: WaiaRuntimeDb)` in `lib/persistence/runtime.ts`: SQLite returns the boundary; Postgres throws immediately (no twin/diary persistence callbacks).
- Transaction orchestration remains in `db/waia-transaction.ts`; persistence modules do not own transaction policy.

## Current Runtime Transaction Path

**Production path today:**

```
production callers
  → runWaiaSqliteLegacyTransaction
    → runSqliteTransaction
      → sync SQLite db.transaction (better-sqlite3)
```

**Also available (not used by production callers yet):**

- `runWaiaTransactionOnRuntime(handle, fn)` — `handle` from `getWaiaRuntimeDb()` / `WaiaRuntimeDb`; **`fn` remains `WaiaSqliteTransactionCallback` (SQLite-shaped, synchronous)**. SQLite delegates to the legacy facade; Postgres rejects before `fn` runs.

## Remaining Work

### D5 (remainder after D5a)

- Backend-specific repositories / runtime-aware persistence boundaries
- Do not create fake backend-neutral persistence
- Prepare validated paths for future Postgres behavior

### D6 (remainder after D6-core)

- Consider routing `runWaiaTransactionOnRuntime` Postgres branch (separate slice; optional)
- Consider neutral `runWaiaTransaction` only after explicit policy + both backends validated

### DEE-72

- Adapt twin persistence for Postgres after transaction/persistence boundaries are honest

### DEE-85

- Remove SQLite from codebase only after Postgres runtime is fully validated

## Forbidden Shortcuts

- Do not introduce `runWaiaTransaction` before real Postgres transaction support exists
- Do not widen `WaiaSqliteTransactionCallback` to Promise-returning
- Do not migrate production callers to `runWaiaTransactionOnRuntime` before D5/D6 readiness
- Do not call Postgres `db.transaction` before Postgres persistence and rollback semantics are validated
- Do not reuse SQLite callback types for Postgres semantics
- Do not add casts to fake backend compatibility
- Do not remove SQLite until DEE-85

## Invariants

- `runWaiaTransaction` absent in TypeScript source until D6 or later
- `runWaiaTransactionOnRuntime` limited to the transaction seam module and tests until caller migration is explicitly approved (D5a may add `lib/persistence/runtime.ts` for persistence resolution only; it must not broaden transaction callback semantics).
- `runSqliteTransaction` limited to `db/types.ts` and `db/waia-transaction.ts`
- `WaiaSqliteTransactionCallback` remains SQLite-shaped and synchronous
- Postgres branch must reject before callback execution (callback must never run for `kind: "postgres"`)
- Production callers remain on the SQLite legacy facade until a migration slice explicitly changes that

## Final Closure Criteria for DEE-64

- Runtime transaction boundary is explicit (facade + optional runtime seam; no hidden routing in callers)
- SQLite assumptions are isolated (typed callbacks, documented sync semantics, low-level `runSqliteTransaction` not imported by app code)
- Production callers no longer depend directly on low-level SQLite transaction helper (`runSqliteTransaction` re-exported only through `db/waia-transaction.ts` policy)
- Future Postgres transaction path is sequenced and guarded (reject until D6; no neutral API until honest)
- Remaining Postgres persistence work is clearly delegated to DEE-72 / D5 / D6 as applicable
- No fake neutral transaction API exists

## Related Docs

- [Postgres development / migrations (D6-pre)](../postgres-development.md)
- [Transaction architecture contract](../architecture/transactions.md)
