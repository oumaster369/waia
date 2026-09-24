# DEE-1072 — scoped financial snapshots and confirmation safety

## Context and goal

The console audit on main `286cb19a` reproduced cross-scope balances, real balances repeated in paper/history, failed observations shown as zero, stale USDT balances counted as current, incomplete coverage denominators, nondeterministic quote provenance, and invoice A confirmations retained for invoice B.

This bounded repair implements the financial foundation of audit P1, shared account/overview/assistant reads from P3, and the urgent invoice confirmation isolation from P4. It follows `dee-1050-admin-console-v2.md` sections 3–3.1 and C2, and AC-01, AC-02, AC-03, AC-04, AC-05, AC-11, AC-15, AC-31. It does not declare those complete across all console sections.

## Delivered behavior

- Overview and account list use the same `REPEATABLE READ READ ONLY` snapshot, deduplicated account rows, aggregate, full coverage and financial revision. Scope filters apply after global ownership conflict detection. The assistant retains the original query context.
- Observation evidence follows the collection state's last-observation binding and validates the normalized payload against account and organization. Missing, invalid, incomplete and failed observations remain distinct. Last complete evidence survives a collection failure with a timestamp and stale status, outside current sums.
- Real exchange cash belongs to live portfolios. Explicit paper/history requests cannot acquire it. The compatibility `all` financial request returns an explicitly labelled live projection; modes are not added together.
- The 64-account synchronous valuation budget remains. Every deferred account still contributes to the denominator and carries `ACCOUNT_CAP`. First connection comes from the earliest complete observation, not a credential update.
- HTX/USDT valuations cannot be overwritten by USD prices. FX price/time/source affect the valuation key; quote age and skew apply to FX as well. Unknown assets are excluded individually with partial coverage. Decimal math stays in the existing risk numeric module; unsupported precision is explicitly unavailable, never rounded or passed through Number.
- Lot revisions include quantity/cost and stable ordering, and account attribution checks credential ownership. These changes are read-only; execution and financial ledgers are unchanged.
- Six manual issuance confirmations belong to the selected invoice and its saved revision. They reset on invoice/version changes and submission. No issuance is performed by this repair.

## Boundaries

No schema migration, credential secret read, external exchange call on a read path, trading command, fee/HWM/settlement policy change, validation bypass, live activation, automatic invoice issuance, holdout payload read, or methodology ratification. Existing authentication/authorization services are preserved.

The user explicitly delegated operational PR review/merge/deployment gates on 2026-09-24. That delegation is not an invoice attestation or a financial policy decision. Merge only after required exact-head CI passes.

## Acceptance and verification

- Unit regression cases distinguish observed zero, missing/ERROR/invalid/stale evidence, source binding, paper/history cash, empty scope, FX revision/age and quote provenance; ownership mismatch and quantity changes cannot inherit prior lot evidence.
- Real migrated PostgreSQL tests cover two organizations, exact decimal amounts beyond JavaScript safe integer range, two credentials for one account, ownership conflict, last complete evidence, full denominator above 64, and HTTP/assistant revision equality under identical scope and period.
- A browser scenario selects invoice A, manually checks six boxes, selects invoice B, and verifies six unchecked boxes, disabled approval and no POST.

Commands: `pnpm lint`; `pnpm typecheck`; `pnpm build` (also run by the Playwright production server); `pnpm test --run tests/unit/admin-console* tests/unit/admin-assistant*`; `WAIA_PG_INTEGRATION=1 DATABASE_URL_POSTGRES=<disposable-local-db> pnpm test --run tests/integration/admin-console-financial-snapshot-postgres.test.ts`; `pnpm test:e2e tests/e2e/admin-console-a11y.spec.ts --project=trader-host --workers=1`.

Full unit and Postgres integration suites are authoritative on the final PR head. The isolated PostgreSQL fixture retains append-only synthetic observations; it refuses a non-local database.

## Follow-up boundaries

Remaining audit packages continue separately: operational PnL/history, other entity read-context and CSV parity, full invoice chain/revision commands, stream handoff, shell/context/design, all eight section workflows, assistant grounding, production schema/deployment verification and complete browser acceptance. No completion claim for those is made here.
