---
integrationIssue: DEE-999
integrationTitle: "Byte-exact bounded hydration acceleration"
branch: dee-999-bounded-hydration
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
  status: approved
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Implement private hydration-lifetime byte reuse with reference equivalence and unchanged verification; no original-corpus execution."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-999 — bounded private hydration validation

## Authority and evidence

The user resumed autonomous historical readiness work on2026-09-12, after
authorizing necessary local fixes and decision-making. This plan exercises that
engineering scope, not a new scientific/production/Human-ratification authority.
Root prepared a draft and created this isolated branch before code changes.
Base5edd55114f088a5adea00866c337d4273f702c2a. One issue, plan, branch and future PR.

Full original BTC30 package hydration reached its3600s diagnostic limit without
a report. It was not restarted. Local unchanged-code CPU profiles found repeated
component quantization and decoding dominant, not proven O(n²) or a deadlock.
A separate bounded immutable-snapshot suffix prototype matched reference bytes:
18 tests PASS. At syntheticN1000/K50, original pool-only validation median247.31ms
versus26.49ms end-to-end prototype including snapshot/allocation/cleanup,4 trials.
This is not full hydration or production speed/ETA. Original code remained unchanged.

## Goal and non-goals

Remove repeated source-anchor suffix serialization in private hydration validation
while retaining every source/draw/chunk/manifest/content/pool verification. Preserve
canonical bytes, numerical laws, quantizer, headers, ordinals and mutable public
pool-digest semantics. No package encoding or sampling change, new score protocol,
dataset/capacity reduction, skip-on-error, new admission flag or forged receipt.

No migrations, application deployment, checkpoint writes, full-corpus retry,
Forecast/bootstrap, scientific evaluation, private credentials, live/capital,
blind holdout or Human-gate changes. Brier/Cody and native bootstrap integration
are separate issues. This optimization does not authorize old artifacts in a new
release; explicit original-provenance reuse admission remains DEE991 work.

## Work packages and files

- WP-1: private decoded-package ownership boundary and bounded suffix byte reuse
  in lib/trader/intelligence/forecast-v2/predictive-package-codec-v1.ts; at most
  one adjacent helper and focused tests. Keep original pool-semantic-digest-v1.ts
  untouched when feasible; any necessary refactor must preserve its public API
  and all original byte behavior. No caller-supplied cache/digest bytes.
- WP-2: original codec/digest/quantizer and new differential/negative tests,
  end-to-end bounded synthetic hydration benchmark, lint/typecheck/build and
  independent exact-diff review before publication. Root owns integration/PR.

## Ownership, memory and fallback contract

Only a single synchronous final-validation operation over a privately assembled
decoded package may share bytes across pools. No global cache or reuse across
hydration calls. Do not mutate or freeze original returned package objects.
If private ownership cannot be demonstrated, use owned snapshot isolation rather
than assume mutable caller data is immutable. Both sync and async hydration retain
their original verification stages; no new public trust/skip switch.

Use an explicit finite arena/index backing cap and scoped cleanup; account for
object/index-map overhead separately. A backing cap is not a total heap guarantee.
Capacity exhaustion or unsupported optimization size/shape falls back to original
full validation, not reduced checks or rejection of otherwise valid packages.
No environment knobs, dependencies or changes to scientific identity fields.

## Acceptance

Reference exact-stream/digest equality including repeated anchors/K50, all states,
shuffled/duplicate ordinals, binary64 extrema/subnormals/signed zero and rounding
boundaries, cap0/partial/full, independent lifetimes and alias/mutation safety.
All original malformed source/draw/chunk/manifest/pool digest refusals remain.
Full codec round trips prove the integration; pool-only prototype tests do not.
End-to-end timing includes ownership setup, allocation, all checks and cleanup.
Measured memory and finite cap/fallback behavior recorded honestly, no production
speed guarantee. Lint/typecheck/build/targeted tests and required exact-head CI,
independent review with no P1/P2, base freshness required before merge.

## Rollback

Revert the isolated optimization to original full verification, without data or
checkpoint changes. No scientific receipt may be relabeled or downgraded. A failed
benchmark or review keeps the patch local; no production retry to obtain a PASS.
