---
integrationIssue: DEE-1106
integrationTitle: "Preserve prior Decision-sealed Guardian protective actions"
parentIssue: DEE-639
branch: dee-1106-guardian-protective-action
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Validate the bounded correction; integrate serially after PR669. No trading activation."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1106 — Prior conditional Decision owns protective action

## Problem and existing contract

On main3e15dc8c, the protective pipeline consumes a valid mandate and then calls
the ordinary recommendation matcher. A CLOSE_FULL mandate bound to a HOLD or
REDUCE_PARTIAL assessment therefore fails before Risk; a partial mandate bound
to REDUCE_FULL similarly fails. Its one-use claim is already committed.
The DEE-636 ratified narrow exception derives the action and maximum quantity
from the prior Decision-sealed mandate, independently of ordinary reassessment.
A six-case synthetic probe with deliberately denying Risk reproduced this;
no connector, database, production or financial effect was performed.

## WP-1 — Minimal correction

Derive the protective action and current-exposure-relative quantity from the
already validated and exactly bound mandate. Validate positive, non-amplifying
quantity before claiming it once. Do not apply the ordinary recommendation's
fresh Decision action/size matcher to this prior conditional Decision. Preserve
the matcher unchanged in the ordinary pipeline. Keep all assessment/lot/lineage,
mandate, trigger, Reality and expiry checks, dedicated-executor refusal for
TIGHTEN_PROTECTION, fresh Risk, Execution and Reality boundaries.

A Risk or Execution refusal after claim remains consumed: this package creates
no retry/release mechanism. Zero quantity after scale-8 rounding is rejected
before claim. Include Guardian V2 in the existing native-Postgres CI path filter;
retain all eight existing capital suites and require a ninth Guardian persistence suite.

## Acceptance

New regression cases prove full/partial mandate actions across each ordinary
recommendation, current remaining quantity bounds, rejected zero before claim,
foreign/expired/tampered bindings, unchanged tightening refusal, single-use
concurrency and no retry after Risk refusal. Synthetic ports use real canonical
contract builders; an uncertain report remains uncertain, not a fill. Ordinary
Decision action/quantity refusals continue to pass.

Run targeted Guardian, Risk protective posture, Runtime, Execution and consumer
graph regressions; actual nine mandatory PostgreSQL suites; lint/typecheck/build,
canon, governance, both consumer validators and rendered PR preflight. Full unit
and e2e CI are required on the final PR head. Self-review is disclosed, never
represented as independent Human or scientific qualification.

## Boundaries

No schema, rate/HWM/accounting, thresholds, source qualification, new action,
venue adapter, credential, Org0 binding, C3 host or live activation change. No
new protective authority: repair the existing DEE-636 mandate contract. Full
thesis model, fresh qualified producer, all-position fairness/scheduler and
production Guardian adapters remain P11/P10.
User authorized technical fixes and eventual merge after checks; scientific and
operator launch gates remain separate.

## Local evidence

The first regression run failed8/passed13 before the correction. Final23 protective
cases plus adjacent Guardian/Risk/Execution/Runtime coverage pass93 tests/15files.
All168 actual-Postgres tests in8 mandatory capital suites pass without skips,
and the executed-proof guard passes. These are isolated loopback fixtures, not
production account or live execution qualification. Graph regressions pass12/2.
Lint0errors/324existingwarnings, typecheck/build/canon/governance pass.

Only inventoried consumer `guardian-reduction-pipeline-v2.ts` changed; no new
imports or connector references. Refresh its content seal on this base to
`a73a619ebaa72625147635cdf8034a847c56eb9b502b985e08fca5d08140347e`.
Counts155sources/134consumers/26references, source content/path digests, inventory
rules and admitted boundaries stay unchanged. Serial rebase after PR669 must
reconcile the combined consumer content seal rather than retain either stale seal.


## Native mandate and assessment acceptance

Extended the same package with eight real-Postgres Guardian cases, preserving
all existing production repository implementations. Eight independent sessions
are observed blocked by a rolled-back uncommitted claim; then exactly one wins
and seven fail on the org/mandate key despite different trigger/content digests.
Assessment replay/readback, separate connections, tenant reads/write denial,
actual composite foreign keys, immutable triggers, retained consumption after
reconnect/changed trigger/time, and rollback-before-commit are checked.

The ninth mandatory CI suite is enforced by the executed-proof guard (missing,
failed, empty, skipped and duplicate results reject). Combined176 actualPG/9files
PASS with no skips;42 focused tests/3files including10 guard checks PASS. Previous
93 targeted/15files and12 graph cases still cover unchanged Guardian production
code. Lint/typecheck/canon/governance rechecked. Build remains valid for identical
production files; this extension changes tests, the CI proof script and docs only.
No schema/trigger/grant changes or production database connection are performed.
The initial eight-case proof was refined to reconstruct the changed consumption
from draft fields explicitly, then rerun in the full nine-suite acceptance.
This proves repository-level reconnect/concurrency, not a process-crash host
recovery loop, monitoring scheduler, actual protective trigger or venue effect.
