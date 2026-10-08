---
integrationIssue: DEE-1233
integrationTitle: "Received stop evidence and bounded optional financial observations"
branch: dee-1233-protection-evidence
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, mounted-e2e, lint, typecheck, build]
approvalGates: [independent-review, exact-runtime-admission]
state:
  status: in-progress
  currentWorkPackage: WP-FINANCIAL-INGESTION
  completedWorkPackages: [WP-STOP-EVIDENCE, WP-DAY-LEDGER-CONTRACT, WP-FINANCIAL-INGESTION]
  remainingWorkPackages: [WP-RUNTIME-QUALIFICATION, WP-COMPLETE-PROTECTION, WP-DAY-RESULT]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: ce1464be2f69a64d120968ea8922c02ee7497be3
  lastValidationAt: "2026-10-08"
  blockedReason: "V5 selection completeness and remaining closing-quantity semantics are not yet qualified; full-day ledger remains incomplete."
  nextAction: "Publish the locally qualified source as a draft PR, require new-head CI, then qualify exact release/runtime compatibility and finite current-account scope before any activation. Complete protection and daily result remain separate."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1233 — received stop and financial evidence

The user requests autonomous continuation of the Trader and prohibits trades or
changes to the external executor. Main03e and protected reader have been deployed;
the previously integrated Overview plan is historical completed source work.
This work package continues the existing issue without closing its broader
protection and daily-result acceptance.

## Scope

The current snapshot lists correlated SL/TP orders but gives the same generic
warning for absent SL, multiple/duplicate orders, different quantities and partial
source coverage. Explain these distinctions using only the already authorized,
persisted snapshot. No new requests, routes, polling, schema or runtime changes.

- Preserve exact position object membership, account/snapshot binding upstream,
  contract, side, margin, active state and one-way reduce-only guards.
- Keep protection UNCONFIRMED in every case. Partial/unknown history is not complete
  protection; TP is not SL. A fresh empty result is not proof of a missing stop.
- Report typed reasons for read failure, invalid time, stale data, unbound/ambiguous
  position, incomplete source, no received matching SL, duplicate identities,
  multiple SL candidates, unsupported quantity and unqualified closing semantics.
- For exactly one non-duplicate matching SL, compare the received decimal quantity
  to the actual position quantity exactly (less/equal/greater). This is received
  quantity comparison only, never executable remaining coverage or a percentage.
  Do not sum orders, round via Number or equate equal amounts with protection.
- Render simple Russian reasons, quantity comparison and the separate source read
  times. On stale/error/scope refresh, clear comparisons; retain no old verdict.
- Existing raw order listing and TP separation remain available. No capital actions.

## Validation and boundaries

Focused tests must cover exact decimal/scientific values including precision beyond
Number; zero/invalid/bounded exponent rejection; partial empty and TP-only; duplicate
IDs even across types; multiple candidates; source/error/time/stale and unique-row
guards. Mounted component tests cover updates from current to stale/error/changed
snapshot and explicit never-protected wording. Add assertions to the existing local
synthetic account-observation browser scenario. Run relevant lint/type/build and
independent exact-delta review; full unit runs only on eventual PR CI.

No production probe, HTX call, Grok access, order/stop/key/lease/schedule/mode change,
database migration, canonical Risk/finance/billing input or research change. Primary
HTX semantics review is independent; if completeness or closing semantics cannot
be established, leave full protection open instead of manufacturing a green state.

This work package can be locally committed after verification. A later coherent
issue package decides publication; do not auto-close DEE-1233 for this partial slice.

## WP-STOP-EVIDENCE validation — 8 October 2026

Implemented typed reasons, bounded exact decimal comparison for one unambiguous
received SL, both ID duplicate fences, separate source times and clearing on
stale/error/snapshot change. Every outcome remains UNCONFIRMED.

59 focused unit/component tests passed. Full lint has zero errors and 337 existing
warnings; typecheck and a fresh Next build passed. The mounted cabinet/Admin scenario
passed with synthetic data, including scope revocation and zero account-action
requests. The two other scoped browser scenarios passed in the initial run.
That initial mounted run reached all UI assertions but its final overly broad
request assertion counted the existing console visit-marker POST. The corrected
test exempts only that exact metadata endpoint; the one affected scenario was rerun
against the same unchanged build and passed. Both independent reviews approved the
exact source and test deltas. Root inspected desktop/mobile crops.

Local fixture SQLite and temporary browser configuration were removed after evidence
capture; the owned server stopped. No production/venue/Grok/credential change or
complete-protection/UI-production acceptance is claimed by these local checks.

## Public V5 contract qualification — 8 October 2026

The official [HTX API documentation](https://www.huobi.com/en-us/opend/newApiPages)
loads its content from a same-origin public documentation service. The category
`5531` identifies USDT-Margined Futures Multi-Assets Collateral. Public GETs of the
documentation required no credentials and made no account or trading API calls.

- [Algo pending orders](https://www.huobi.com/oplt/api/open_api/interface/detail?interface_id=8cb89359-77b5-11ed-9966-19b9754d736)
  and [positions](https://www.huobi.com/oplt/api/open_api/interface/detail?interface_id=8cb89359-77b5-11ed-9966-19594266bd8)
  document quantities in contracts. The pending-order query is per type and has
  `from`, `direct`, and a maximum page size of 100. The descriptions do not establish
  page exhaustion, a stable atomic snapshot, remaining executable quantity, automatic
  resizing or OCO semantics. Equal received quantities still do not prove protection.
- [Financial records](https://www.huobi.com/oplt/api/open_api/interface/detail?interface_id=8cb89359-77b5-11ed-9966-19b930b8bee)
  document separate IDs, type, currency, signed amount and creation time. The transfer
  example has an empty contract code despite the field being marked required.
  Missing amount-sign and complete-history guarantees prevent a canonical day result.
- [Execution details](https://www.huobi.com/oplt/api/open_api/interface/detail?interface_id=8cb89359-77b5-11ed-9966-195898804f0)
  have inconsistent history-window descriptions. Fill closing PnL must not be added
  to financial-record settlement/closing entries without a proven reconciliation rule.

Contradictions in the official examples are retained in the audit evidence: pending
orders show a canceled example despite an active schema; positions disagree on
`last_price` and `mark_price`; algo placement and reading differ on `tp_sl`/`tpsl`.
None authorizes relaxing existing fail-closed readers or completeness labels.

## WP-DAY-LEDGER-CONTRACT

Add a pure financial-record parser using the existing bounded lossless JSON reader,
and an exact observed breakdown grouped by currency and financial type within an
explicit half-open time window. Preserve unknown numeric type codes and raw signed
amounts. An empty input has no money groups; actual offsetting rows may yield an
observed zero. Duplicate identities, malformed amounts and invalid timestamps must
be refused. Do not infer fee signs, convert currencies, sum overlapping financial
types, combine fills and bills, or expose a total/day-PnL result.

This prerequisite remains unwired: no live route allowlist, transport, collector,
snapshot, UI, schema, cadence, credential or production change. It does not establish
source authorization, account identity, ingestion, completeness or day-start equity.
Focused parser/arithmetic tests, type/lint checks and independent review are required;
the previously completed display/browser/build campaign is not repeated for this
unreachable pure helper.

### Local validation

The parser and breakdown are implemented. The final focused campaign passed 54 tests
(34 parser, 20 breakdown); scoped lint and full typecheck passed. The original
25,742 bytes of the live read-contract module are an exact prefix, and the live
route allowlist, builders, transport, reader, snapshot and UI remain unchanged.
An initial test-table fixture expanded empty arrays into arguments; those two test
fixtures were corrected and the failed result retained. Independent review approved
all four code/test paths and this work-package plan. No production or account API
calls, new build, existing-test campaign or authority expansion occurred.


## WP-FINANCIAL-INGESTION — optional bounded received records

Implement a default-absent financial capability on an exact V5 assignment under the
existing non-trading authority. A fresh technical scope ID, expected UID, fixed
half-open window of at most 48 hours, and a finite validity interval of at most ten
minutes are bound into the configuration revision and explicit financial manifest
v2. This does not introduce another blanket Human-consent requirement. Existing
scope/consent IDs, enrollment templates and stored observations cannot activate it.
No renewal, configuration CAS, manifest mutation or production activation occurs here.

The reader may issue one fixed signed GET `/v5/account/bills` page of at most 100 rows.
Financial scope cannot coexist with fill contracts or legacy derivatives in this
first slice. The existing V5 31-attempt/120-second budgets, scheduler cadence, lease
limits, credential purpose, exact permission/UID/key binding, connection/TLS limits
and cancellation ownership remain in place. Separate current-key admission associates
received records with the account; the bills body itself does not prove account identity.

Only a configured financial assignment emits strict V5 observation v2/account
observation v4. Old DTO versions and omitted-configuration hashes remain unchanged.
Persist raw signed rows and exact groups by currency and raw type. Unknown types are
retained; empty means no received records; every successful page is PARTIAL/UNKNOWN.
Net/day PnL stays null. No sign conversion, currency conversion, fills reconciliation,
page exhaustion, backfill cursor, ledger completeness or canonical Billing input exists.

### Optional-scope availability invariant

Temporal unavailability is local to financial history. Expired/not-yet-valid scope
emits `UNAVAILABLE` with `SCOPE_EXPIRED`/`SCOPE_NOT_YET_VALID`; financial rows, groups,
page scope and all read times are null, as are financial errors and all PnL outputs.
Base Spot/Futures observations remain authorized under the same current binding.
The manifest/fixed assignment and already-authorized shared credential opening are
not refused solely because optional scope is unavailable. Structural scope errors
still fail configuration parsing. The financial transport rechecks its scope before
and after awaited admission and aborts on expiry; no extra decrypt is introduced.
Optional financial errors do not change the base collection's cadence/backoff.

Database insertion chooses the allowed/sanitized DTO using database time. An
amount-bearing result must also pass the final latest-pointer publication predicate
and post-write clock check. If a slow INSERT/trigger crosses optional expiry, a private
marker rolls back that transaction and retries exactly once with the same observation
ID, current binding and live lease, forcing only the amount-free UNAVAILABLE variant.
No immutable record is updated; no new lease, scope, remote request or authority is
created. The publication gate is the linearization point, not the later network
COMMIT acknowledgement. Financial commits return the exact actual stored DTO. An
old amount-bearing acknowledgement cannot be replayed under an expired scope.

### Implementation and qualification boundary

Core reader/admission/configuration/DTO/grouping and JSON append changes are local.
No database schema, migration, role/grant, host, key, schedule, order, Grok, production
or research changes are part of this package. The browser-safe grouping extraction
was validated through the affected parser/arithmetic tests. Core focused tests cover
absent capability, fixed signed one-page query, multiple currencies/unknown types,
empty/error/invalid input, temporal expiry before/during request, after awaited
admission, abort settlement, service sanitization/actual acknowledgement, old manifest
compatibility, strict DTO tamper refusal and expired fixed-assignment availability.
The previous stop59/build/protected-runtime proof is not repeated for unchanged bytes.

A separately gated native test is authored at
`tests/integration/account-observation-financial-postgres.test.ts`; root alone runs it
on the explicitly created empty loopback TLS fixture at port 55841, database
`waia_financial_fixture`. It checks actual restricted LOGIN/RLS append/readLatest,
expiry sanitization and idempotency, stale/revoked scope fences, and a delayed INSERT
with exactly two insertion attempts but one immutable record and latest pointer.
Root subsequently executed five native cases plus one added adversarial caller-mutation case successfully. The repository captures the observation, binding, lease and cadence before its first await; retry cannot be redirected by changing the original input. The controlled delayed-insert proof retained exactly one record/pointer after two attempts. Root also qualified the UI, mounted browser scenario and fresh build; independent source review resolved the mutable-input finding. Production
consumer compatibility and a fresh exact technical execution receipt remain separate
admission gates; no live financial-history or whole-Trader readiness is claimed.

Core local verification: 330 distinct focused tests across 12 affected suites passed
in the scoped runs (including 26 new financial-ingestion cases). Full typecheck
passed after core/native-test authoring; scoped lint had zero errors (four existing
unused-variable warnings in the assignment test). Root subsequently qualified six distinct native cases; nine cabinet-view and seven bills-UI tests also passed. Full lint has zero errors and 337 existing warnings; typecheck, fresh Next build and mounted tenant/admin Chromium scenario passed. Desktop/mobile layouts preserve exact raw signed amounts, separate USD/USDT, partial coverage and unavailable state; revocation clears account data and no trading request is sent. Production activation and complete-history/PnL/protection acceptance remain pending.
