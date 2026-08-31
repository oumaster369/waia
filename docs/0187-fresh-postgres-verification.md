# Migration 0187 fresh-PostgreSQL verification

Date: 2026-08-31 (Europe/Moscow)

Scope: disposable local PostgreSQL 16 database `waia_validate_0187_final`.
No production database or credentials were used.

Evidence:

- Applied the validation auth prelude to a newly created empty database: PASS.
- Applied the literal canonical Drizzle journal from migration `0000` through `0187`: PASS (`migrations applied successfully`).
- Ran `tests/integration/postgres-canonical-decision-verification-v2.test.ts` against that database: 1/1 PASS.
- The integration assertion covered all six 0187 relations, RLS enablement, owner-only policy posture, authenticated-role denial, append-only triggers, and an actual rejected owner-side update.
- Focused unit tests: 15/15 PASS.
- TypeScript no-emit typecheck: PASS.
- `git diff --check`: PASS.

The database was purpose-created for this verification and is not an assertion about any production migration state.
