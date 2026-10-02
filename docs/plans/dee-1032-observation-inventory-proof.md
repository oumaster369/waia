---
integrationIssue: DEE-1032
integrationTitle: "Self-service HTX observation: enroll on Connect without Human manifest admit"
branch: cursor/dee-1032-observation-inventory-proof-c7a8
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit-tests, lint, typecheck, build]
approvalGates: [pr-758-merged, dee-961-no-longer-blocking, migration-0230-remains-deferred, human-review]
state:
  status: blocked
  currentWorkPackage: draft-pr-not-merge-ready
  completedWorkPackages: [reconstructed-inventory-repair]
  remainingWorkPackages: [wait-for-pr-758, resolve-dee-961-blocker, independent-review, exact-head-ci]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: "Draft until PR #758 merges and Linear DEE-961 is no longer blocking. Migration 0230 is deferred and must not be applied. Migration 0229 must not be applied."
  nextAction: "Keep the PR draft. Rebase onto origin/main after #758 merges, then re-check DEE-961 before any merge-ready claim."
provenance:
  authoritativeBase: e4123437c569d9a7e8dead214284f1271ff426cd
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1032 — observation inventory proof

## Context

The merged Connect enroll path still inventories active HTX collection-state by `SET LOCAL ROLE waia_account_observer` without `waia.observation_org`, `waia.observation_credential`, or `waia.observation_account`. Migration 0205 `FORCE ROW LEVEL SECURITY` hides those rows, so a newly enrolled account is not discovered. The Oct 1 repair was prepared off-repo. Saved heads `52c16604de547706a42d1af99eb2a2104dea9bcc` and `91750ba69afb4740f5f58e46149cae550f1c286c` are not on this remote, and the handoff bundle was not on this machine. This branch reconstructs that contract onto `origin/main` at `e4123437c569d9a7e8dead214284f1271ff426cd`. It is not a verified byte copy of those commits.

## Scope

- Journal migration `0230_trader_account_observation_spot_inventory_v1` adds a private function owner and an EXECUTE-only caller. The function returns identifier columns for active HTX rows whose stored configuration revision and symbols equal the sealed spot envelope, and raises on invalid input or more than 20 matches.
- The collector calls that function as `waia_account_observation_inventory`. Inventory failure clears the dynamic assignment cache and surfaces `ACCOUNT_OBSERVATION_ASSIGNMENTS_FAILED` instead of continuing as an empty inventory.
- The collector login may `SET` exactly the observer role and the inventory role. Reader and credential logins do not receive the inventory role. The caller role has no table privileges and no ciphertext grant.

## Out of scope

- Applying migration 0230 or 0229 to production.
- Live trading, real orders, Org0 UI, secret values, or enabling a collector in production.
- Widening collector `INSERT`, key decryption, or browser discovery.

## Acceptance

- A restricted inventory read can see a newly enrolled active HTX spot assignment that matches the sealed envelope, and cannot see ciphertext or insert collection-state.
- More than 20 matching rows, a revoked credential, a non-HTX credential, or an inventory error refuses the cycle and drops previously cached dynamic accounts.
- Explicit manifest assignments remain the reserved prefix. A derivatives envelope does not open spot inventory.
- Targeted unit tests, lint, typecheck, and build pass on this head. Native PostgreSQL proof remains the account-observation CI job. This does not claim scientific or production readiness.

## Blockers

- [DEE-1015](https://linear.app/deepsense/issue/DEE-1015) is Done. The Linear `blockedBy` relation is still present; the status itself is not a remaining blocker.
- [DEE-961](https://linear.app/deepsense/issue/DEE-961) is In Review and still blocks DEE-1032. Do not mark this PR merge-ready while that relation is blocking.
- [DEE-1153](https://linear.app/deepsense/issue/DEE-1153) and [DEE-1157](https://linear.app/deepsense/issue/DEE-1157) are Done.
- GitHub PR #758 (DEE-1150) is open and not merged. This PR stays draft until that serialized predecessor lands and this branch is updated onto the resulting `main`.
