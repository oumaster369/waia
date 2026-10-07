---
integrationIssue: DEE-1236
integrationTitle: "Preserve configured observation state during self-service enrollment"
branch: dee-1236-preserve-observation-enrollment
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, native-postgres, build, pr-governance]
approvalGates: [plan-approved, independent-review, exact-head-ci, release-admission]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: validation
  completedWorkPackages: [implementation, targeted-regression]
  remainingWorkPackages: [validation, publication]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Complete local readiness, independent review and exact-head PR CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Problem and scope

Listing a connected HTX account calls self-service enrollment. That enrollment
previously rewrote an existing collection row when its configuration differed
from the default. This could replace an operator-qualified observation revision
and symbol scope during an ordinary account-list request.

Preserve every existing exact organization/credential/account row. Enrollment
creates missing state only, rechecks after the capacity lock, and preserves a
concurrent winner. Credential identity, active status, observation permission,
capacity checks and new Read+Trade observation enrollment remain unchanged.

## Acceptance

Focused unit and disposable PostgreSQL tests cover account-list preservation of
the whole row, existing enrollment at capacity, concurrent insertion, new
enrollment and credential replacement/revocation. Run lint, typecheck, a fresh
build and PR governance checks. The complete unit suite runs in PR CI.

## Authority and boundaries

This is a narrow correctness repair within the user's explicit instruction to
continue the Trader release autonomously. It changes no schema, credential,
venue scope, account mode, trading capability or risk limit. Independent review
and current technical release checks remain required.

Migration memory: no migration or database contract change. Existing migration
journals and the held inventory migration remain untouched.

## Release and recovery

Source integration closes this atomic issue; parent DEE-1231 stays open for
runtime acceptance. Publish the corrected Worker with observation projection
disabled first. Restore the affected configuration only through a separate
reviewed operation bound to current state, after the faulty writer is closed.
Preserve scheduling and leases; require subsequent natural observations before
acceptance. An older Worker containing this bug is not a safe rollback target.

Protected-reader activation, all-current-account cabinet acceptance, full-day
history, profit accounting, protection and research qualification remain outside
this source-fix integration boundary.
