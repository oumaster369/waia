---
integrationIssue: DEE-1016
integrationTitle: "C3 multi-host acceleration operator, repository only"
parentIssue: DEE-950
branch: dee-1016-c3-multi-host-operator
riskTier: T3
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
  completedWorkPackages: []
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Repository operator only. Do not dispatch shards or touch the running C3 campaign."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1016 — Multi-host operator packet

Pure operator for a fresh missing-offset inventory, deterministic shards, host
claims, evidence import, incomplete retry, and exact coverage reconciliation.
It does not import the Forecast producer and does not open a network or host.

### WP-1 — Fail-closed operator mechanics

Synthetic fixtures prove freshness, disjoint shards, claim collision, conflicting
import refusal, retry of only the still-missing offsets, and a coverage gap.

## Acceptance

- Completed offsets are excluded from a fresh inventory. A later completion makes that inventory stale.
- Two host slots receive a repeatable disjoint partition whose union is the inventory.
- A second host cannot claim an owned offset.
- Identical evidence imports once. A different digest for the same offset is refused.
- Retry lists only offsets that are still missing. Reconciliation refuses a gap.
- The module does not import the historical simulation producer or `placeOrder`.

## Non-goals

No host provisioning, no shard dispatch, no Execution Server, no change to P2, G1,
or the running C3 campaign. DEE-950 stays In Progress.
