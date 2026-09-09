# DEE-960/961 — local integration acceptance, 2026-09-09

Scope: user-approved local storage/adapters, PostgreSQL17 validation and shared
account observation interfaces. This is not production acceptance, real account
verification, scientific qualification or permission to trade.

## Implemented in this continuation

- Additive PostgreSQL migration 0205, journal entry and Drizzle declarations,
  preserving the previously reviewed prototype semantics. Existing migrations
  were not rewritten. Dedicated least-privilege collector and reader roles remain
  separate; neither obtains encrypted credential payloads through this storage.
- Explicit recurring runtime joins scheduler, repository and reader ports. No
  work starts on import. Authorized assignment loading and credential opening are
  injected; configuration identity hashes symbols and timing parameters. A hash
  does not manufacture authorization.
- Local HTX reader accepts only injected signed-GET transport. Exact account and
  revision binding, raw response parsing, decimal arithmetic, page/byte/record
  bounds, abort/disposal and per-order account proof for trade rows are checked.
  No signing implementation, key lookup or real network call was introduced.
- Shared DTO preserves unknown order update time as null rather than inventing a
  timestamp. The venue's bounded history and ordinary-order coverage stay PARTIAL.
- Reproduced and fixed two integration defects: healthy PARTIAL coverage no longer
  causes permanent failure backoff; an interrupted account receives the first
  turn in the next scheduler sweep instead of starving behind earlier accounts.
  Error components still cause persisted capped backoff. No-overlap and revoke
  fencing remain enforced.

## Evidence

- 219 focused unit/integration checks PASS, including 53 domain-core, 58 mocked HTX
  reader, 19 actual PostgreSQL repository/runtime, 9 restricted-reader, 4 full
  migration-chain, 5 runtime-composition, and 71 shared UI/route checks.
- Scheduler 6/6 PASS, including red-to-green fairness reproduction; runtime 5/5
  also rechecked alongside scheduler. Do not count the repeated 5 twice.
- Full 0000–0205 chain and actual Drizzle migrator PASS under a limited local
  administrator; full 0204-to-0205 upgrade preserves synthetic credential and
  balance-snapshot rows and proves revocation fencing. Auth role prerequisites
  use the repository's local-only prelude. No production database fallback exists.
- Composed runtime test uses actual PostgreSQL and the new HTX reader with mocked
  raw REST responses: two recurring commits without any browser, truthful PARTIAL
  coverage, persisted cadence on process restart, and revoked-binding refusal.
- 3/3 browser tests PASS after a fresh Next production-mode build: automatic
  Admin/tenant updates and revoke clearing, anonymous Admin denial, historical
  surface isolation. HTTP observations are fixtures; SQLite is used only for the
  existing isolated browser-test identity runtime, not new Trader storage.
- Typecheck, scoped ESLint, canonical documentation/release identity checks and
  Reality consumer closure PASS. Reality remains 154 sources, 127 consumers,
  25 connector references; the new reader is observation-only, not an admitted
  canonical Reality source or execution authority.
- Independent bounded reviews checked migration integration, scheduler/runtime
  and HTX reader. The two proven runtime findings were fixed with regressions.
  These reviews are not a whole-Trader certification or production proof.

## Remaining path; do not mark either issue Done

1. Package the local work into the authorized review/CI workflow; the dedicated
   local PostgreSQL test opt-in must be integrated into a suitable CI job before
   claiming remote mandatory checks. No push, PR, merge or deployment in this slice.
2. Implement/qualify separately authorized assignment provisioning and a bounded
   credential-capable GET transport; strict key/account admission precedes opening
   it. Existing transport injection is not a production-ready HTX connection.
3. Qualify unsupported order/fee cases before claiming whole-account coverage:
   pre-trigger conditional orders, market-buy amount units, rebates and fee points.
   They are explicitly partial or refused, never silently relabelled.
4. Approve production migration/role/pool configuration and a separately deployed
   recurring owner, verify capacity, revocation/restart behavior and both panels
   using actual authorized read-only account evidence. Automatic UI updates here
   use bounded polling, not SSE. No full positions/accounting/PnL stream is claimed.
5. Historical scientific preparation is independent and was not restarted or
   changed by this work. Its successful qualification and run acceptance remain
   necessary; live Decision/Risk/Execution and capital admission remain separate.

Private exchange credentials, real account requests, production migrations,
deployment, live trading, capital and blind holdout remain untouched.
