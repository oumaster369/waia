# Postgres development and testing (DEE-64 D6-pre)

This document defines how WAIA’s **Postgres** side (parallel to SQLite) is bootstrapped for **local development**, **migrations**, and **optional integration tests**. It is **infrastructure-only**: no real Postgres transaction runner, no production runtime switch, no DEE-72 persistence migration.

## Honest current state

| Area | Status |
|------|--------|
| Drizzle schema | [`db/schema.postgres.ts`](../db/schema.postgres.ts) — source of truth for **types and generator input**. |
| SQL migrations | [`db/migrations_postgres/`](../db/migrations_postgres/) — **authoritative apply target** for shared environments (Drizzle Kit `migrate`). |
| `drizzle-kit push` | **Not** the team workflow for canonical schema. `push` mutates a DB without leaving versioned SQL in-repo; use only for personal experiments and **do not** treat pushed DBs as reproducible. |
| Production app | Still **SQLite** by default (`DATABASE_URL`, `getDb()`). `WAIA_DB_BACKEND=postgres` is **not** a supported production path yet (see DEE-72 / tracker). |
| Transactions | **D6-core:** [`db/waia-postgres-transaction.ts`](../db/waia-postgres-transaction.ts) provides `runWaiaPostgresTransaction` with async semantics. **Explicit backend-specific API only** — no production runtime routing yet. SQLite semantics unchanged. |
| RLS / Supabase `auth` | [`schema.postgres.ts`](../db/schema.postgres.ts) documents gaps. Migrations include stubs for local CI only. |

If generated migrations drift from `schema.postgres.ts`, **document the gap** and regenerate with `pnpm db:generate:postgres` before merging (review SQL by hand).

## Migration policy

1. **Edits** to the logical schema happen in [`db/schema.postgres.ts`](../db/schema.postgres.ts).
2. **Versioned SQL** is produced with Drizzle Kit:
   - `pnpm db:generate:postgres`  
   - Config: [`drizzle.postgres.config.ts`](../drizzle.postgres.config.ts) → output [`db/migrations_postgres`](../db/migrations_postgres/).
3. **Apply** migrations to a target database:
   - `DATABASE_URL_POSTGRES=<url> pnpm db:migrate:postgres`
4. **Auth stub for Docker / empty Postgres**: migrations reference `auth.users` for FK alignment with future Supabase. Bare Postgres has no `auth` schema; apply the prelude **before** first migrate (or after wiping DB):
   - `pnpm db:postgres:auth-prelude`

The prelude **duplicates** [`scripts/postgres-validation/prelude-auth-stub.sql`](../scripts/postgres-validation/prelude-auth-stub.sql); keep them aligned.

## Local Postgres (Docker)

Compose file: [`docker-compose.postgres-validate.yml`](../docker-compose.postgres-validate.yml) (Postgres 16, port **54329**).

```bash
# Start and wait for healthcheck
pnpm db:postgres:up

# Connection string / env for tools and smoke scripts
export DATABASE_URL_POSTGRES='postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate'

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
- **CI**: optional workflow [`.github/workflows/postgres-integration.yml`](../.github/workflows/postgres-integration.yml) runs on `workflow_dispatch` (manual) so Postgres does not slow every PR until you promote it.

## Security and environment hygiene

- Scripts that mutate data (`db:smoke:postgres`, `db:postgres:auth-prelude`) **must** target **local** hosts only (same guard pattern as [`scripts/postgres-validation/drizzle-pg-smoke.ts`](../scripts/postgres-validation/drizzle-pg-smoke.ts)).
- Never point smoke scripts at production-like hosts.

## Related docs

- [DEE-64 tracker](migrations/DEE-64-TRACKER.md)
- [Transaction architecture](architecture/transactions.md) — SQLite vs Postgres semantics; D6-core transaction work
