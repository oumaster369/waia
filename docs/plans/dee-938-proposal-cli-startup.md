---
integrationIssue: DEE-938
integrationTitle: "Historical proposal CLI startup correction"
branch: dee-938-proposal-cli-startup
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-ci]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge, human-production]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-2
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Open one PR for exact-head CI/review; stop before merge/deployment"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Human-approved scope

On 2026-09-06 MSK the Human authorized a separate Linear issue and minimal PR
for the proposal-startup defect and regression coverage, **without merge or
deployment**. This blocks the remaining DEE-920 rollout. Exact base is
`dd90c618cecae41394362569a205a37ca57b3834` (PR #552 squash).

No algorithm, formula, dependency, module-system configuration, schema, role,
ratification, live/capital or blind-holdout changes. No production writes,
execution-host mutation or replacement of its immutable image in this task.
Preserve all user WIP and previously completed rollout evidence.

## Root cause and correction

The canonical proposal CLI uses top-level await, but package.json does not select
ES modules. The actual Node 22 / locked tsx command fails during CJS transformation
before database access. Reproduced on local Node 22.22.3 and host Node 22.23.0.
The existing image-packaging preflight checked file presence, not CLI invocation.

WP-1: Move the unchanged proposal operation into an async main and use the same
direct-execution guard as the approved-launch CLI. Retain pool cleanup, output
schema and all canonical scope/authority checks; explicitly return nonzero on error.

WP-2: Execute both canonical files using real Node/tsx child processes, outside
Vite transforms and mocks. A strict environment allowlist omits database URIs,
credentials and NODE_OPTIONS. Expect the exact missing-DB refusal (not a transform
failure), and verify importing the proposal does not execute it. Run existing
proposal/host contract tests and normal PR gates.

## Acceptance and limits

The new subprocess regression must fail on the unmodified base and pass after
the correction. Lint, typecheck and production build must pass. Authoritative
unit and applicable full gates run on the PR exact head; no timeout/assertion/gate
is removed. No UI change, so no new local browser scenario is required.

Startup smoke proves loader compatibility and fail-closed behavior only. It does
not prove dataset qualification, successful proposal persistence, historical
rehearsal, dual-panel parity, adaptive learning or profitability. Those remain
DEE-920 gates after separate exact-head review, merge and rollout authorization.
Rollback of this source change is a single revert; do not patch deployed artifacts.

## Local validation evidence

- Real subprocess regression on the original base: two failures from the proposal
  top-level-await transformation, one approved-launch check passing.
- After correction: all three subprocess checks pass. Five focused CLI, host,
  ratification-handler and ceremony test files: 23/23 pass, zero skips.
- Full lint: zero errors (308 existing repository warnings); changed code files
  lint clean. Typecheck and the canonical `pnpm build` (Next/Turbopack) pass.
- `git diff --check` and canonical-doc validation pass.
- An exploratory noncanonical webpack build failed on an existing `node:crypto`
  client dependency path; no unrelated code was changed. The required canonical
  production build subsequently passed with real local locked dependencies.

Full PR CI and independent review remain pending; these local results are not
historical rehearsal evidence. Human explicitly excluded deployment: automatic
Cloudflare preview deployment must not run, and any cancelled preview gate must
remain visibly non-passing until separately authorized.
