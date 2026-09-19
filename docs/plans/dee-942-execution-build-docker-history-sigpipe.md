---
integrationIssue: DEE-942
integrationTitle: "Execution build: eliminate informational docker-history SIGPIPE under pipefail"
parentIssue: DEE-920
branch: dee-942-execution-build-docker-history-sigpipe
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
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
  nextAction: "PR to main after independent in-diff P1=0 P2=0 and required CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-942 — docker-history SIGPIPE under pipefail

Incident recorded on [DEE-920](https://linear.app/deepsense/issue/DEE-920):
`docker history "$IMAGE_TAG" | head -n 20` under `set -euo pipefail` returned
`PIPESTATUS=141 0` after a successful image build and in-image preflight, so
`pnpm install --frozen-lockfile` and revision recording never ran.

## Goal

Inspect the first 20 history lines without closing the producer early. Real
`docker history` failures still fail the build. Do not rebuild a successful
current image.

## Work packages

### WP-1 — Consuming inspect

Replace `head -n 20` with `sed -n '1,20p'`, which prints 20 lines and keeps
reading the rest. Prove a producer larger than the pipe buffer no longer yields
141, and that a failing producer still propagates.

## Acceptance

- Build script no longer pipes `docker history` to `head -n 20`.
- Large-output consumer exits 0.
- Failing producer still exits non-zero.
- No Dockerfile, algorithm, or deploy-script change.

## Non-goals

- Do not rebuild or deploy an Execution Server image.
- Do not change C3, holdout, live-enable, or production `0211`.
