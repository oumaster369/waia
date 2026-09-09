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

## Subsequent local transport and CI slice — 2026-09-09

This supersedes the missing transport implementation and CI authoring portions
of remaining items 1–2 above, not their production acceptance requirements.

- Added the bounded signed-GET transport described in
  `docs/trader-account-observation-get-transport.md`; 49 mock-network tests PASS.
  Exact-key admission and authorized key opening remain injected, not a deployed
  credential integration. No real HTX requests were made.
- Final combined reader/transport/Reality guard run: 113/113 PASS; typecheck PASS.
  Reality now has 128 consumers, with the transport explicitly observation-only;
  source count 154 and connector-reference count 25 remain unchanged.
- Added dedicated account-observation PostgreSQL17 CI configuration; all 32
  integration tests PASS locally using its exact serial command. Four CI-contract
  checks and both YAML parses PASS. Existing historical workflow is byte-for-byte
  unchanged. GitHub CI has not run for this local slice.
- Full repository lint exits successfully with zero errors and 307 warnings;
  this is not a warning-free result. Scoped new-code lint and diff checks PASS.
- No new UI behavior was changed in this slice. Previous browser proof remains
  fixture-based and is not being represented as real-account acceptance.

Assignment provisioning, production admission/credential wiring, unsupported
venue cases, production rollout and actual two-panel acceptance remain open.

## Historical schema compatibility — 2026-09-09

Reproduced the existing full-checkout preflight test failure after adding 0205:
`UNKNOWN_APPLIED_MIGRATION`. The required historical baseline remains 0000–0204.
An explicit optional compatibility list now admits only the exact journal identity
and checkout bytes of `0205_trader_account_observation_v1`. Historical execution
on a database through 0204 does not require account-observation provisioning.
Unknown later migrations, altered hashes, wrong timestamps and duplicate applied
identities are rejected. Future AI-TWIN migrations are NOT implicitly admitted.
Existing SQL, scientific criteria, table requirements and roles are unchanged.

20 targeted preflight tests PASS. Four actual PostgreSQL17 migration checks PASS:
SQL packaging, fresh full chain, actual Drizzle migrator and data-preserving upgrade.
The actual historical preflight is invoked on 0204 and after 0205, including under
the limited migration owner. Typecheck/scoped lint/diff checks PASS. Independent
bounded review found no proven P1/P2 in these three changed source/test files.
This is local compatibility evidence, not production or scientific acceptance.

Coordinate future shared journal registration through DEE-960 / DEE-871. Keep one
integration owner for numbering and compatibility review; do not rewrite historical
migration bytes, automatically accept unknown migrations, or touch the running
scientific preparation to integrate unrelated account/Twin work.

## ORM compatibility and explicit configured composition — 19:42 UTC

Local uncommitted delta on HEAD6e35edb8. Removed the optional observationRevision
projection from the shared legacy credentials ORM; 0205 column/default/trigger and
explicit observation queries are unchanged. Actual repository insert/get/list/revoke
under limited PostgreSQL17 owner was RED before0205 and now passes both before/after
0205, including cross-tenant refusal and revision increment on revoke. Four additional
legacy SQL projection unit regressions also demonstrated RED then GREEN.

New configured-runtime explicitly joins trusted assignments, separate reader and
collector SQL clients, protected credentials, mandatory injected venue admission,
signed GET transport and the recurring owner. Construction performs no network/key
opening. One-shot run/cancellation/disposal retains caller ownership of SQL pools.
Actual PostgreSQL17 integration demonstrates two collections followed by revocation
preventing further credential opening/HTTP. Keys, venue responses and venue admission
are synthetic test dependencies, not production/HTX acceptance.

Verification:88 selected unit PASS; migration4/storage19/reader11=34 actual PG17 PASS,
then the changed storage integration file20/20 PASS with the new composed test.
TypeScript PASS, scoped lint0errors/1 existing schema warning, diff-check PASS.
New fixture corrections were min interval1000 and exact holdings free/locked fields;
no production safeguards weakened. No full repository build/GitHub CI claimed here.
Independent bounded read-only review found no proven P1/P2 in the new composition.
Local test database stopped with data retained. No production/science changes.

Outstanding qualification: genuine current exact-key venue admission implementation,
protected provider/pool/provisioning in deployed host, transport coverage-limit identity
(currently pinned per instance but outside persisted config hash), PR/release gates,
and real authorized two-panel read-only acceptance. This closes the local composition
gap only, not live trading authority or historical scientific qualification.
