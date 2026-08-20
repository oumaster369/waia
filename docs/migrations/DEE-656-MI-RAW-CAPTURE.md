# DEE-656 — MI Raw Capture V1 foundation

**Linear:** DEE-656 · **Includes:** DEE-657, DEE-658 · **Tier:** T2

## Scope

Postgres migration `0153_trader_mi_raw_capture_v1` adds append-only, organization-scoped
storage-binding, capture-receipt, and record-only validation-receipt tables. Postgres stores only
private-object references and content-addressed receipts; exact raw body bytes stay outside the
database. SQLite has no counterpart under ADR-0017.

`RawCapturePolicyV1` has no production default. The repository has no object-store client, bucket,
KMS binding, runtime route, or production policy values. Capture requires an exact-body digest-bound
secret-scan `PASS`; transport headers, cookies, authorization material, query parameters, provider
inventories, Observation kinds, and Measurement semantics are outside the contract.

## Security and causal invariants

- Raw-byte digest, storage-binding digest, and capture-receipt digest are distinct.
- Composite foreign keys bind every reference to one organization and canonical Source.
- `captured_at` and validation `known_at` are overwritten by transaction-time triggers; callers do
  not supply validation knowledge time through the repository API.
- All three tables reject update/delete and deny `authenticated`/`anon` through RLS.
- `VALID` / `REJECTED` receipts are explicitly `RECORD_ONLY` with no Observation or Measurement
  authority. Rejected evidence is retained rather than converted to zero or silently dropped.

## Rollback and validation

Rollback before any apply is a revert PR. A later Human/operator-reviewed migration would remove
the three additive tables, policies, triggers, and helper functions. DEE-656 applies no production
SQL and creates no production storage.

```bash
pnpm test --run tests/unit/trader-mi-raw-capture-v1.test.ts
WAIA_PG_INTEGRATION=1 pnpm test --run tests/integration/postgres-mi-raw-capture-v1.test.ts
pnpm test --run tests/unit/forecast-v2-applied-migration-identity-v1.test.ts
pnpm lint && pnpm typecheck && pnpm build
```

Migration-bearing PR CI applies the full journal from empty Postgres. Human review/squash merge is
required; production, holdout, live/capital, and Execution Server gates remain closed.
