---
integrationIssue: DEE-989
integrationTitle: "Scientific qualification: preflight every baseline before bootstrap"
branch: dee-989-baseline-preflight
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
  status: in-progress
  currentWorkPackage: validation
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: "T3 exact-change publication/merge hold; scientific semantic changes excluded."
  nextAction: "Commit validated patch; obtain exact-head T3 publication approval before push/PR."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Approved scope

User requested a deep audit, Linear remediation and fixes on 2026-09-12. This single
backend package fixes delayed detection of invalid statistical inputs without changing
the scientific law. Base: 6ab1b156a14fb883043f3c6c81c5365be858ffe2.

The failed production run is frozen at 90de233a. Its first three comparisons completed
before a later non-finite differential refused qualification. Existing DEE-950 canon
explicitly requires this refusal; it does not permit smoothing production baselines.

## Work packages

- WP-1: RED regression: a fourth baseline with zero observed-bucket support must
  refuse before ANY resampling/progress, with bounded baseline/anchor identity.
- WP-2: preflight every available baseline using the exact existing bootstrap input
  checks before the generator first yields. Retain original valid-path arithmetic,
  order, trial identity, receipts, corpus and B=10000. Hold at most one temporary
  baseline differential array at a time, not five permanent arrays.

## Validation

Test fourth-baseline failure, zero challenger mass, invalid later baseline, finite
receipt parity, intermediate overflow, unavailable baseline and empty-input behavior.
Independent review; lint/typecheck/build; required exact-head PR CI before merge.
No production or full scientific rerun is part of local validation.

## Acceptance

No epsilon, pseudocounts, clipping, deleted observations, removed baseline, thresholds,
changed availability classification or conversion of arithmetic failure into a normal
statistical rejection. No migrations, credentials, cache relabeling, deployment or
real capital. A GREEN preflight regression prevents wasted resampling; it does NOT
qualify the real candidate. Zero-support semantics remain DEE-992; checkpoints DEE-991;
external process-outcome reconciliation DEE-990. No included child completion claimed.

## Implementation evidence — 2026-09-12

The initial RED test observed 120 resampling progress events before late refusal on
the unmodified implementation. The correction validates every available comparison
with the unchanged kernel preparation and finite-value/centering checks before any
resample is evaluated. Bounded refusal metadata includes a fixed baseline ID and
SHA-256 anchor identity, never the raw caller-supplied anchor string.

Ten new regressions pass, including fourth/fifth comparison early refusal, challenger
zero support, NaN/infinities, finite-input sum overflow, unavailable/empty inputs,
and complete synchronous/asynchronous result parity against the original-main fixture.
Original finite fixture result SHA-256:
`78e503bf43cfcb12137c974f58304bd2cee8c232e5c498c0ef4c089454b29486`.
The existing multi-anchor known-answer, integration, streaming and cooperative suites
remain required; the single-anchor golden alone is not sufficient evidence.

Independent read-only review found no actionable P1/P2 in this bounded implementation.
Existing synchronous preparation gains an O(baselines × anchors) validation pass;
there is no claim of eliminating all pre-first-yield CPU time.

Local full lint: exit 0 (307 existing warnings); typecheck: exit 0.
Standard `pnpm build` (Next.js Turbopack) passes with worktree-local dependencies.
The earlier linked-dependency build failed on a local out-of-root symlink. An optional
webpack diagnostic build failed on a pre-existing client/server import path; it is
not claimed to pass or treated as a new scientific-code defect. No build settings or
application imports were changed. Governance PR-body preflight passes.
Final combined preflight, streaming parity, known-answer and cooperative suites:
49 tests pass across four files; the separately run harness admission integration
suite passes all 10 tests (59 targeted tests total). `pnpm validate:pr-governance`
passes all constituent regression scripts. `git diff --check` passes.
Full unit and other mandatory exact-head gates remain authoritative in GitHub CI.

Separate audit finding DEE-993 concerns the frozen CDF's huge-argument branch.
Neither that numerical law nor zero-support semantics (DEE-992) is changed here.

## T3 publication boundary

The user authorized audit and local remediation in this turn. Per
`AGENT-AUTO-ADVANCE.md`, automatic publication does not include T3. Preserve the
validated local commit and present its exact head for publication approval; no
GitHub CI PASS, PR creation, merge or deployment is claimed before it occurs.
