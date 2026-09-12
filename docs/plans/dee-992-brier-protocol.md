---
integrationIssue: DEE-992
integrationTitle: "Human-ratified bounded Terminal score and preserved-origin compatibility"
branch: dee-992-brier-protocol
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build, postgres]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Prepare the bounded PR when authorized; DEE-991 full-origin admission and DEE-993 remain separate gates."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-992: bounded Terminal score

## Approval and limits

Human approved alternative A and local implementation with DEE-991 compatibility
checks on 2026-09-12. Base: 78188f9d3d035b459d619531127321218845de3d.
The exact approved proposal is preserved in
[amendment-v1](dee-992-brier-protocol-amendment-v1.md), SHA-256:
694d625c2120d3e5410a7395646bd0bae728ea08e08fc8ea93043061cdb8d8de.
Its historical DRAFT heading precedes this explicit ratification.
No deployment, production migration, scientific corpus scoring/bootstrap, original
checkpoint modification, credentials, capital, holdout, push or merge. Local tests
use synthetic fixtures. Original DEE-991 diagnostic worktree remains untouched.

## Scientific contract

Primary reward: -sum((p[j]-indicator(j=y))²), all seven original categories,
larger is better. No scaling, clipping, floor, filtering or renormalization.
Seven dense finite probabilities in [0,1]; ascending sum within 1e-12 of 1.
Invalid probabilities/grid/outcome refuse before bootstrap. Original log score
remains secondary, retaining zeros and +Infinity/-Infinity/NaN differential counts.

Unchanged: DEVELOPMENT fitting, target grid, all observations, all five baselines,
common PIT anchors, horizons, purge/embargo, VALBOOT1 dependence/null-centering,
B=10000, positive-mean gate, Holm FWER 0.05. No adaptive learning/live authority.
A changed metric may change ranking; it does not imply qualification or profit.
Previously inspected WALK_FORWARD remains disclosed re-analysis, not untouched
confirmation. Frozen DEE-518 log-score text is superseded only in this bounded
Terminal primary-scoring domain by the exact ratified amendment, not elsewhere.

## Work packages

- WP-1: validated score, all-baseline preflight, log diagnostic retention.
- WP-2: exact version/metric/amendment through Terminal/scientific/four-surface,
  first/next-cycle consumers and SQL binding; reject old/mixed evidence.
- WP-3: local DEE-991 checker of original SHA/runtime/key, package/data/grid/model/
  normalization/randomness/partition dependencies, payload and original anchor/outcome
  mapping. No store IO/builders, relabeling or authority issuance.
- WP-4: focused tests, PostgreSQL 17, lint/typecheck/build and independent review.

## Version registry

| Contract | Local version |
| --- | --- |
| Primary score | multiclass-brier-reward/v1 |
| Trial metric | terminal-multiclass-brier-reward/v1 |
| Harness | research-harness-admission/v4 |
| Harness digest namespace | scientific-admission-receipt/v4 |
| Predictive Terminal receipt | predictive-terminal-receipt/v2 |
| Outer scientific admission | scientific-admission-receipt/v3 |
| Terminal checkpoint stage | wf-predictive-terminal-v2 |
| Bootstrap law | validation-bootstrap/v2 (unchanged) |

## Database compatibility and recovery

0201 pins outer receipt v2 in runner RLS. Local migration0206 changes that
predicate to v3 and adds exact nested Brier versions/amendment. Every original
tenant/request/proposal/approved-surface/Human/aggregate predicate remains identical.
The SQL binding reader shares the writer's version constant. No tables, records,
credentials or privileges rewritten; no RLS disabled. Migration numbering requires
reconciliation with then-current main before merge. Production apply remains separately
authorized. Recovery: stop preparation, retain evidence, separately approve any
policy/application rollback. Never treat old log-score admissions as new evidence.

## Evidence and unfinished boundaries

183 focused unit tests across17 files passed, including44,100 expected-score
comparisons, worker parity, negative admissions, original-key/store parity, RLS delta.
Typecheck passed. Lint:0 errors,307 repository warnings. Next production build passed.
Fresh isolated PostgreSQL17 applied all migrations through0206.
51 focused integration tests passed,2 conditional provisioning cases skipped.
Three additional selected Forecast persistence/idempotence tests passed; three
unselected cases were not run. Their first local run correctly refused a missing
immutable build SHA; rerun with the explicit local base SHA passed, without bypass.
Independent read-only review identified one async accessor-validation bypass.
Original probability entries are now checked before structuredClone; the regression
proves zero getter invocations and zero bootstrap progress in sync/async rejection.
The reviewer rechecked the fix: no outstanding P1/P2 within the reviewed local diff.
This is focused local evidence, not all-repository CI, E2E or full historical acceptance.

## Acceptance

- [x] Primary Brier formula, strict probabilities and immutable amendment binding.
- [x] All five baselines and original log diagnostics retained without weakening gates.
- [x] Old/mixed receipts refused in consumers and locally migrated runner RLS.
- [x] Pure preserved-origin compatibility checker and original key parity tests.
- [x] Focused unit/PostgreSQL 17 checks, typecheck, lint, build and independent review.
- [x] Original checkpoints, production state and scientific execution untouched.
- [ ] Full original-store provenance and production dual-origin adapter (DEE-991).
- [ ] Independent CDF correction (DEE-993) before any new evaluation.
- [ ] Remote CI, merge, authorized rollout and scientific acceptance (not this local approval).

DEE-991 checker returns LOCAL_BINDINGS_MATCH_NOT_ADMISSION: authenticated whole-store
read, independently reconstructed COMPLETE input inventory, full anchor coverage and
production dual-origin evaluation adapter are NOT established. Missing metadata
refuses without generation. All old score/bootstrap/Holm evidence needs separate
authorized recomputation. Source bars/packages/forecasts are preservation candidates,
not new authority. DEE-993 CDF defect remains open and blocks fresh evaluation.
No scientific/reuse/production PASS or historical-test readiness is claimed.
