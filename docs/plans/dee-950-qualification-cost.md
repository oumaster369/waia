---
integrationIssue: DEE-950
integrationTitle: "Bound allocation and repeated address setup in full-data qualification"
branch: dee-950-qualification-cost
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, targeted-unit, build]
approvalGates: [plan-approved, integration-ready, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-REVIEW
  completedWorkPackages: [WP-BOUND-COST, WP-OPTIMIZE, WP-ORACLE]
  remainingWorkPackages: [WP-REVIEW]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Root review; retain DEE-947 evidence revisions on integration; remaining readiness gates"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Approved scope and dependency

Human approved DEE-946–951 implementation and PR preparation on 2026-09-06.
This local T3 package optimizes only the same frozen SHA-256 addressed bootstrap;
no commit/push until root review, no merge/deployment/production/private credentials/capital/holdout.
Frozen authority: [DEE-518 §2.4.0/§2.6.1](dee-518-ai-trader-correctness-mathematical-intelligence-fhv-v1.md).

DEE-947 corrects the restart probability to 1/L and invalidates old evidence. The
shared walker below uses that corrected bound; integration must retain DEE-947's
validation-bootstrap/v2 and all receipt invalidation/version changes. This package
does not independently replace that dependency or relabel old qualification results.

## Minimal implementation

1. Bind immutable domain/root/modulus limits once while keeping every replica/sample/draw/retry
   semantic address explicit. Reuse a local 64-byte preimage, never a mutable PRNG cursor.
   Retain existing createHash API to avoid adding a crypto.hash requirement to Worker bundles.
2. One shared stationary index walker for resample vectors and p-value folding. Bootstrap
   sum is accumulated in exactly the former left-to-right order (no regrouping/prefix sums).
   Do not allocate two N-element arrays for each of B=10000 resamples in the p-value path.
3. Independent SHA-256/big-endian/unbiased-rejection oracle, exact index vectors and floating
   sums, full B=10000 small-N p-value parity, invalid root/bound/address tests.
4. Reproducible bounded benchmark with runtime/hardware/scale; no full dataset job.
5. Reject non-finite inputs and intermediate overflow without changing valid summation order.
   Preserve the inherited zero-probability baseline fixture as a refusal regression; make
   positive/negative controls genuinely finite rather than smoothing production baselines.
6. Include DEE-947 v2/v3 evidence namespace and exact known-answer/stale-receipt tests from
   b13ec46a. No relabeling of old evidence.

## Unchanged and explicitly not closed

All anchors, B=10000, baseline-specific trial roots, K/M, null centering, one-sided >=,
Monte Carlo denominator, Holm/positive-mean gates and corpus remain intact.
No new migrations or qualified-evidence reuse authority.

This bounded optimization does NOT prove acceptable full-data runtime. Full qualification
still has O(surfaces × baselines × B × anchors) hashes plus Forecast issuance/scoring.
Progress/cancellation, durable exact-evidence reuse, bounded parallel scheduling and target-host
feasibility remain DEE-950 work; do not mark the issue Done or historical preparation ready.

## Executed local evidence

Eight focused files/90 tests PASS after finite guards, including full B=10000 independent
oracle parity, actual rejection retry and prior CBRNG/harness regressions. After copying
DEE-947 regressions, two files/20 tests PASS (9 known-answer tests and 11 scientific admission
tests including stale receipt/relabel rejection). This covers 100 distinct tests across
nine files, with scientific admission deliberately rerun. Final script-inclusive typecheck,
scoped ESLint without warnings and git diff --check all PASS. Production/OpenNext build and
combined integration review remain root release gates; this package does not claim them.
Reproducible benchmark and remaining cost/parallel/cache requirements:
[DEE-950 qualification cost evidence](../ops/dee-950-qualification-cost-evidence.md).
Measured final-code local speedup is1.319× at N128/B10000, not the1.61× unimplemented prototype.
