# DEE-654 — MI PIT trust-as-of foundation (Split A)

**Linear:** DEE-654 · **Tier:** T2 · **Canon:** AI-TRADER Steps 1–2

## Scope

Postgres migration `0152_trader_mi_pit_trust_as_of_v1` adds nullable `available_at` to
`trader_mi_source_trust` and `trader_mi_observation`, plus append-only/content-addressed
`trader_mi_trust_as_of_receipt_v1`. SQLite has no counterpart under ADR-0017.

Split A does not add raw capture/validation, choose providers or Observation kinds, define
Measurement semantics, cut over runtime paths, or grant capital authority. Mutable Source status
is excluded from historical resolution. V1 trust/Observation digests remain unchanged.

## Invariants

- Event, availability, and ingest instants are independent; all must be explicit, valid, and no
  later than the anchor. Existing nullable rows remain `UNKNOWN`; ingest never substitutes.
- Only an organization/source-scoped complete visible predecessor prefix resolves. Future-only,
  missing/invalid chronology, gaps, duplicates, broken links, and cross-scope history fail closed.
- Receipt `id = content_digest`; replay is idempotent. Composite FKs bind Source/selected trust,
  mutation triggers block update/delete, and RLS denies `authenticated`/`anon` all actions.

## Rollback and validation

Rollback before any apply is a revert PR. A later reviewed operator migration would remove the
new table/guards/indexes and nullable columns; DEE-654 executes no destructive SQL.

```bash
pnpm test --run tests/unit/trader-mi-trust-as-of-v1.test.ts
WAIA_PG_INTEGRATION=1 pnpm test --run tests/integration/postgres-mi-trust-as-of-v1.test.ts
pnpm lint && pnpm typecheck && pnpm build
```

Migration-bearing PR CI applies the full journal from empty Postgres. **No production SQL or
production migration was applied in DEE-654.**
