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
  currentWorkPackage: WP-COOPERATIVE
  completedWorkPackages: [WP-BOUND-COST, WP-OPTIMIZE, WP-ORACLE]
  remainingWorkPackages: [WP-COOPERATIVE, WP-REVIEW, WP-FULL-DATA-FEASIBILITY]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Validate cooperative execution on the real technical-proposal path; retain all resamples and exact receipt parity. Full-data feasibility and durable progress/resume remain open."
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

## Cooperative computation — 2026-09-06 20:51 UTC

The shared pure bootstrap now has a private step generator consumed by both the existing synchronous API and a cooperative asynchronous API. Both evaluate exactly all10000resamples and every position with unchanged arithmetic and addressed randomness. The async path yields to the event loop between complete resamples, capped at250resamples or about250000positions per quantum (minimum one whole resample). Callbacks receive frozen counts only, not an injectable result. Abort or callback failure rejects without a partial p-value. Centered data/root are owned before awaiting.

The research harness shares its original algorithm through a private generator; the async driver calls only the actual bootstrap kernel and owns a snapshot of all history/anchors/metadata. Predictive-terminal construction shares the same validation and sealing logic, with owned identity bindings. The actual historical technical-surface preparation now awaits that async constructor. No new qualification version, digest meaning, thresholds, baseline omission or approval authority. This wiring permits event-loop servicing during the bootstrap stage; it does not make preceding Forecast issuance cooperative or prove complete end-to-end cancellation/streaming.

79 focused tests PASS across7files, including10new cooperative tests: complete independent B10000oracle parity; exact predictive receipt parity across all5baselines despite caller mutation; timer servicing; pre/mid/final-boundary cancellation; progress-sink failure; nonfinite refusal; negative terminal evidence. TypeScript/scoped lint/diff passed (one pre-existing unused-input warning). Full repository lint, typecheck and Next production build also PASS in session30835; existing lint warnings retained. This is not a deployment or final combined-release CI.

Synthetic N525600 responsiveness probe on local AppleM5/Node22.22.3 deliberately aborts after8resamples; configured B stays10000 and NO p-value is returned. Eight resamples took1694.07ms, timers serviced7times, RSSpeak156254208bytes; steady measured210.384ms/resample. Linear extrapolation0.5844hours for one complete comparison is NOT a target-server/full-corpus ETA, and excludes Forecast, K/M, I/O and other baselines/surfaces. No production job executed.

Still required: bounded multi-worker equivalence/coverage if adopted, durable exact-release/input/baseline evidence reuse, operator-visible progress and wired cancellation, target-host/full-data preparation, cumulative release review and remoteCI. Do not close DEE950 from this local responsiveness result.

## Current-base and preceding issuance scheduling — 2026-09-06 21:00 UTC

Merged already-approved origin/main b5c17263 locally without conflicts (merge b25c69e16629cf8b8eb3437a4598854c8559453f), retaining PR558 bounded corpus serialization and PR559 admin/stream admission. No remote write or deployment. The WF_PREDICTIVE issuance loop now visits every original anchor in order and yields after each32completed Forecast calls. Individual Forecast calls and package construction remain synchronous; this is not a fixed wall-clock latency bound or parallel speedup. No anchors, probabilities or package inputs changed.

Post-merge checks: full TypeScript PASS;35targeted tests PASS across scientific receipt/cooperative parity, actual production-bootstrap fixture, ratification migration and bounded corpus serialization (including exceeding V8 string limit). Scoped lint has only the existing unused-input warning. A new isolated localPG17database waia_hsv2_it_dee950_v1 has fresh migrations through0202 for this branch; old databases/evidence retained. Native better-sqlite3 was absent and restored using its existing dependency install script before attempting the integration suite; this is local test setup, not a product correction.

Read-only execution-server metadata check found the original qualification receipt digest fc5c63853a4314efd148dc3197f794a88bfcf87652f363fdf7c9e791891a084d: per-symbol DEVELOPMENT1578240bars(2020–2022), WF_PREDICTIVE525600bars(2023), WF_ECONOMIC527040bars(2024). These are receipt bar counts, not independently recomputed valid anchor counts or renewed qualification. No data copied or server process started. The legacy current symlink resolves0d19765d and docker ps returned no running containers; that does not alone establish whether a separate non-container service is running.

At21:01UTC the full sequential PostgreSQL first/35-cycle/restart/negative suite started as session48342 against clean implementation head570d41f12b63541ea8f8659d93f05abcbcf442ee, using waia_hsv2_it_dee950_v1. It is running, not PASS. This exercises the corrected DEE947 bootstrap law and new scheduling on the bounded complete-graph fixture; it does not include the separate DEE946 transport branch yet. No timeout or assertion changes.
