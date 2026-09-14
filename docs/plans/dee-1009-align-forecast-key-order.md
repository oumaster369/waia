---
integrationIssue: DEE-1009
integrationTitle: "Align missing-only Forecast KEY_ORDER digest with sealed G1 contract"
branch: dee-1009-align-forecast-key-order
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-PR
  completedWorkPackages: [WP-KEY-ORDER, WP-VALIDATE]
  remainingWorkPackages: [WP-PR]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Open one PR to main, run canonical CI, and stop at the Human squash-merge gate."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  parentIssue: DEE-950
---

# DEE-1009 — sealed G1 KEY_ORDER alignment

## Scope

The missing-only Forecast producer verifies the ordered inventory key digest
using `keys.join("\n")`, which omits the final newline. Sealed G1 binds the
ordered byte stream containing every key followed by `\n`, including the last
key. This batch changes only that KEY_ORDER digest construction and its
independent unit-test oracle.

The producer must preserve `inventory.batches` order. No Forecast issuance,
package selection, corpus ordering, batch domain, or evidence format changes.

## Acceptance

- KEY_ORDER computes SHA-256 over `key + "\n"` for each ordered batch.
- An explicit three-key regression distinguishes the trailing-newline contract.
- Wrong and reordered key digests still refuse.
- All four rematerialized G1 surfaces match their sealed expected digest without
  Forecast issuance.
- The `issueForecastV1` source closure remains
  `d12bce04839b355e4b3cfda2d96b9d0f3291b0a221ed4bfa67887b8dc2f331c2`.
- Exact diff proves `issueRows`, control issuance, package identity, G1, O, and R
  are unchanged.
- A separate operator receipt records `C1_CARRY_FORWARD=PASS`; the original C1
  receipt is not modified.

## Do not

- Change or reseal G1, change O, or change R evaluator/scientific logic.
- Change Forecast mathematics, `issueForecastV1`, package selection, source
  ordering, batch size, offsets, database, or migrations.
- Rerun C1, apply migration 0208, start H2, or merge this PR autonomously.

## Validation

- `pnpm vitest run tests/unit/missing-only-forecast-producer-v1.test.ts`
- `pnpm eslint scripts/trader/missing-only-forecast-producer-v1.ts tests/unit/missing-only-forecast-producer-v1.test.ts`
- `pnpm typecheck`
- Read-only four-surface G1 KEY_ORDER parity proof
- Exact diff and Forecast source-closure verification
- `pnpm lint && pnpm typecheck && pnpm build`
- `pnpm validate:pr-governance` and rendered-body preflight
