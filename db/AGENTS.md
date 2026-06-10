# db/ — schema, migrations, persistence

**Execution label:** `backend` · **Risk:** schema changes are typically T2+

## Stack

- Drizzle ORM with SQLite (local MVP) and Postgres configs (`drizzle.config.ts`, `drizzle.postgres.config.ts`).
- Generate: `pnpm db:generate` / `pnpm db:generate:postgres`
- Migrate: `pnpm db:migrate` / `pnpm db:migrate:postgres`

## Rules

- **Additive migrations preferred** — avoid destructive changes without explicit issue scope and rollback plan.
- Never commit `.data/` SQLite files or local DB artifacts.
- Follow [`docs/waia-governance/MIGRATION-GOVERNANCE.md`](../docs/waia-governance/MIGRATION-GOVERNANCE.md) and update trackers when runtime semantics change.
- Postgres rollout discipline: [`docs/adr/0002-staged-postgres-runtime-rollout-discipline.md`](../docs/adr/0002-staged-postgres-runtime-rollout-discipline.md).

## Boundaries

- Do not change UI in the same issue unless the Linear card explicitly spans both (prefer split issues).
- Auth schema changes may need `security` review — see [`docs/security-dee52-auth-review.md`](../docs/security-dee52-auth-review.md).

## Validation

```bash
pnpm db:migrate && pnpm test --run
# Postgres path when in scope:
pnpm db:postgres:bootstrap && pnpm db:smoke:postgres
```
