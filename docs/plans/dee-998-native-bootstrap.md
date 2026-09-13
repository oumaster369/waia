---
integrationIssue: DEE-998
integrationTitle: "Exact native bootstrap parity and cost experiment"
branch: dee-998-native-bootstrap
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-review
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: 579
  prUrl: https://github.com/oumaster369/waia/pull/579
  lastValidatedGitSha: 96b25f96166cea33011d5f18357dc71ff0cf8af4
  lastValidationAt: "2026-09-12T16:44:00Z"
  blockedReason: null
  nextAction: "Obtain exact-head CI PASS; keep DEE-998 open for remaining authenticated execution admission."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-998 — exact native bootstrap parity and cost admission

Parent: DEE-920. Risk: T3 numerical correctness. Branch: `dee-998-native-bootstrap`.

Work packages: WP-1 isolated kernel/framing; WP-2 synthetic parity/target cost;
WP-3 independent review, Linux CI regression gate and PR readiness.

## Context and authority

The user authorized autonomous historical recovery on 2026-09-12. DEE-992's
read-only Brier diagnostic passed its necessary mean-improvement condition for
five baselines, but did not qualify any candidate. A synthetic target-host RNG
probe matched one million Node values (including 80 rejection retries) and was
approximately 7.3 times faster. This is not a full-bootstrap speedup or ETA.

## Scope

Build an isolated, bounded native ordinal-range experiment and compare it with
the existing JavaScript reference. No application factory or admission path
will select it in this work package. Preserve B=10000, the SHA256 addressed RNG,
rejection sampling, L=ceil(cuberoot(n)), original ordinal/sample/draw addresses,
left-to-right binary64 arithmetic, null centering and inclusive tail comparison.
Return range statistics, not a partial p-value or qualification receipt.

Acceptance requires exact floating-point bit patterns and ordered resample
statistic digests, not merely similar p-values. Test multiple seeds, cube-boundary
sample sizes, zero/negative/positive and cancellation-sensitive inputs, last
ordinal, complete small runs and a bounded large-N synthetic range. Reject bad
framing, non-finite arithmetic, invalid ranges and unexpected extra input.

Record compiler flags, source/executable/input hashes and host/runtime versions
before interpreting throughput. A native optimization must pass its installed
binary's parity suite. Independent review is required before admission.

## Do not

Do not modify stored checkpoints, issue Forecasts, run corpus bootstrap, change
science thresholds, synthesize Human approval, deploy the application, access
exchange credentials, trade, or touch blind holdout. No cross-release reuse
admission is implied. Existing JavaScript execution remains unchanged.

## Acceptance

Run the standalone parity driver plus existing bootstrap known-answer tests.
Add a Linux CI parity job without removing or disabling any existing gate.
Measure synthetic kernel cost locally and on the target host under bounded
resource limits. If exact parity or speed fails, retain the negative result.
Only subsequently design authenticated complete-range aggregation, recovery
receipt integration and scientific execution admission; these are not silently
granted by the experiment's success.

## Recorded target-host experiment (not a qualification run)

2026-09-12: source SHA256
`83eebd2aa6593b2bd2999409a7d8dffb9e91966e052f669def0539c73d5bfbd9`;
g++ 13.3.0/OpenSSL 3, flags above, Linux x64 executable SHA256
`9e8e479fee638aa95630e17d17b71e17c8ca5571f8ed157f81e5463a6ca631ba`;
Node v22.23.0. All 25 parity and 16 rejection/error cases passed. The shared RNG
passed 1,000,000 addressed draws including 80 rejection retries. Both bounded
server diagnostic units exited 0, stderr empty; data and checkpoint directories
were inaccessible, network disabled. The completed units were then stopped.

At N=525547 / two ordinals, JS took 4766.615ms, native 650.511ms (including process
and input overhead). Four identical eight-ordinal ranges, two repeats:

| Repeat | Serial | Four workers | Identical range bytes |
|---|---:|---:|---|
| 1 | 9837.236ms | 4762.034ms | yes |
| 2 | 9783.904ms | 2474.156ms | yes |

This measured variability prevents promising ideal 4x concurrency. Conditional
linear projection for five BTC30 B=10000 comparisons is about 1.1–2.1h and all
20 four-surface comparisons about 4.3–8.3h. These are **kernel-only estimates**,
excluding missing Forecast generation, baseline construction, durable checkpoints,
economic qualification and release acceptance. No corpus execution was started.

Failures retained: first Linux compile found a collision with libc's `finite`
name; helper renamed `checkedFinite` without arithmetic changes. Independent
review found no concrete P1/P2 numerical mismatch, but requested shared-sampler
retry coverage and centering/resample-overflow negatives; both were added and
passed on the target host. Local build initially hit sandbox IPC denial and then
Turbopack's prohibition on an external node_modules symlink; dependency setup was
corrected without changing application source.

PR CI initially rejected this plan because its acceptance section used a different
heading. The heading was corrected to the required `## Acceptance`; no validator
or scientific assertion was weakened. Local canonical-doc validation was then
rerun. DEE-998 remains open beyond this isolated experiment for complete-range
authenticated accounting and execution admission; PR completion mode is keep-open.
