---
integrationIssue: DEE-1233
integrationTitle: "Explain received stop evidence without overstating protection"
branch: dee-1233-protection-evidence
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, mounted-e2e, lint, typecheck, build]
approvalGates: [independent-review]
state:
  status: in-progress
  currentWorkPackage: WP-DAY-RESULT
  completedWorkPackages: [WP-STOP-EVIDENCE, WP-DAY-LEDGER-CONTRACT]
  remainingWorkPackages: [WP-COMPLETE-PROTECTION, WP-DAY-RESULT]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-08T00:44:45Z"
  blockedReason: "V5 selection completeness and remaining closing-quantity semantics are not yet qualified; full-day ledger remains incomplete."
  nextAction: "Bind financial-history collection and persisted coverage before wiring the qualified local parser into a day-result display; keep protection unconfirmed while its completeness and closing semantics remain unqualified."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1233 — stop evidence

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
