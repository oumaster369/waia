---
integrationIssue: DEE-1076
integrationTitle: "Admin console period evidence and useful overview"
branch: dee-1076-admin-console-period-overview
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, e2e, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1076
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: done
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-25T00:12:59.983619+00:00"
  blockedReason: null
  nextAction: "Open PR, require merged DEE-1074 dependency and exact-head full CI before merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1076 — period evidence and useful overview

## Goal and dependencies

Audit P2/P16 after DEE-1072/1073/1074: connect the accepted operational PnL formula to saved evidence and finish the canonical Overview summary, market/news and algorithm tabs. Canon: DEE-1050 C2/C5/C7, §§3.1/6, AC-02/03/05/20/21/22/34. The shell PR remains a dependency and must merge before this PR.

## Financial read contract

- Retain exact decimal strings and numeric.ts. Operational live result is CLOSE leg_pnl in [start,end) minus OPEN fees in that period; close fees are already in leg_pnl. Show open/close fees separately without deducting them twice. Fee conversion uses persisted fill asset/price; absent or unsupported provenance remains unavailable. No use of historical accounting engine with invented live inputs.
- Attribute every trade's saved legs to one organization/account/mode before summing. Conflicting or missing attribution never produces a guessed zero. Real account balances remain live; paper/history never enter those totals.
- Keep current unrealized separate from period delta. Read immutable equity points for period boundaries. Missing first coverage is explicit partial with actual start; absence of any reliable boundary makes total unavailable while supported components remain visible. Never derive strategy PnL from changes in account equity/deposits.
- The reporting-period external-flow columns are supplied by administrative request fields, not a proven exchange writer (billing/admin-route-handler.ts); they do not establish observed exchange flows. Whole-account return and percentage return/drawdown remain explicitly unavailable.
- One REPEATABLE READ READ ONLY financial snapshot returns accounts, aggregate, breakdown and saved series. Any changed PnL evidence participates in the financial revision. Service fee amounts come only from saved invoice/settlement stages, retain their own denomination/method and never alter issued invoices.

## Projection and history

- Connect the existing 0214 valuation/equity tables to a bounded collector behind the existing collectors flag. Persist new immutable valuations and five-minute points with ON CONFLICT DO NOTHING. Preserve dependency evidence, quote source/age, observation and method; no reader writes, exchange calls, invented points or history recomputation.
- A version with a missing required amount cannot be inserted by replacing null with zero. Show the corresponding evidence gap. Projection is read-only financial computation followed by writes only to console projection tables, not trading state.
- USD uses the persisted USDT-USD quote; never 1:1. Historical series requires appropriate saved denomination/conversion evidence and cannot silently apply a current quote to the past.

## Overview surface

- Five metric cards, explicit coverage/last-known estimate and expandable PnL components, saved equity/PnL/absolute drawdown with gaps, attention, 6–8 account rows, latest fills and trader activity, clients/research and 5–7 news items.
- Market/news and algorithm tabs use the same scoped read models as summary and assistant tools. Source/time/link shown. No inferred news-to-decision causal link, holdout payload or file reasoning.
- Repair attention scope/account/mode filtering and global ownership-conflict detection; deterministic ordering and one item per cause, with NO_TRADE excluded. Governance-wide evidence with no account binding stays explicit rather than leaking unrelated identifiers.
- Graph coordinates use exact scaled integers; financial labels keep original decimal strings. Empty/partial/stale/unavailable remain distinct.

## Acceptance

No changes to commission rate, HWM, settlement, fee finality, auto issuance, Risk/Guardian, execution, live eligibility, return ratification or holdout. The user delegated operational review/merge/deploy, not policy ratification. A proven read-only amount/provenance defect can be repaired with a regression; any critical engine change is separate.

Validate partial sells across three periods, each fee once, same-organization multiple accounts, modes/mock/history, unmatched legs/open lots, zero versus unknown, deposits not PnL, missing history, immutable projection, source revisions and FX. Browser three tabs and scoped drilldowns, all data states. Commands: pnpm lint; pnpm typecheck; pnpm build; pnpm test --run targeted admin-console tests; local PostgreSQL integration; pnpm test:e2e:admin-pg; pnpm validate:canon; exact-head full CI before merge. Production projection rollout and smoke belong to DEE-1075.


## Validation evidence

- 240 console/assistant/authority unit tests passed. New financial Postgres suite passes seven scenarios: real legs and each fee once, mode/account isolation, unsupported fee denomination, legacy missing executions, current endpoint vs immutable history, USD once, projection idempotency/error exclusion, attention scope/conflicts, news/cycle metadata and cross-scope detail denial. Existing financial/scope suites also pass.
- All-eight-section real Postgres browser workflow passes, including three Overview tabs, financial breakdown, exact-value graph, accessibility, scoped cycle detail with 23 stages, selection/Back/scroll and manual synthetic-org stop/read-back. Updated screenshot reviewed at 1280px.
- Typecheck, production build, lint (no errors), canonical-doc validation and execution consumer graph pass. Exact-head CI remains mandatory. No new migration; collector writes existing 0214 projection tables only.
- Current-period endpoint is computed from the same verified read snapshot; it is never inserted as a historical boundary. Custom periods with no exact closing evidence retain components but total is unavailable. USD charts explicitly identify conversion of the saved USDT series at the current persisted FX quote, with quote time; they do not claim historical USD valuation.
- Cycle list/detail share mode and account binding, and Reality requires a saved fill. Historical mode is proved by the actual `trader_historical_simulation_run_start_v2` table (not the obsolete table name in the planning text). Receipt/Guardian links not persisted to a cycle remain explicit.
- The existing lifecycle writer does not prove denomination of non-quote closing fees; readers return CLOSE_FEE_DENOMINATION_UNVERIFIED. Investigation/minimal critical-engine correction is a separate package, not a financial-policy change in this PR.
