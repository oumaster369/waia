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
  currentWorkPackage: WP-COMPLETE-PROTECTION
  completedWorkPackages: [WP-STOP-EVIDENCE]
  remainingWorkPackages: [WP-COMPLETE-PROTECTION, WP-DAY-RESULT]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-10-08T00:34:13Z"
  blockedReason: "V5 selection completeness and remaining closing-quantity semantics are not yet qualified; full-day ledger remains incomplete."
  nextAction: "Qualify the missing primary source contracts before adding confirmed protection; keep this verified local display slice for coherent issue integration."
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
