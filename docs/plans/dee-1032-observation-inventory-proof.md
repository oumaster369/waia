---
integrationIssue: DEE-1032
integrationTitle: "Self-service HTX observation: enroll on Connect without Human manifest admit"
branch: cursor/dee-1032-observation-inventory-proof-c7a8
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit-tests, lint, typecheck, build]
approvalGates: [pr-758-merged, dee-961-no-longer-blocking, migration-0231-remains-deferred, independent-exact-head-review, human-review]
state:
  status: blocked
  currentWorkPackage: pr-759-ci-repair-awaiting-parent-review
  completedWorkPackages: [reconstructed-inventory-repair]
  remainingWorkPackages: [resolve-dee-961-blocker, independent-exact-head-review, exact-head-ci, human-review]
  prNumber: 759
  prUrl: https://github.com/oumaster369/waia/pull/759
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: "Linear DEE-961 remains In Review and blocking. PR #758 and PR #753 are merged; migration 0229 is applied and verified, while inventory migration 0231 remains deferred and unapplied. This document does not assert whole-PR readiness."
  nextAction: "Publish the validated repair on the current main, collect exact-head CI and independent review, and keep DEE-1032 blocked while DEE-961 remains blocking. Exact Human T3 approval is still required."
provenance:
  authoritativeBase: 0f6be381a68589d4abd4c8920b5a1fd3f5a02110
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1032 — observation inventory proof

## Context

The merged Connect enroll path inventories active HTX collection-state by `SET LOCAL ROLE waia_account_observer` without `waia.observation_org`, `waia.observation_credential`, or `waia.observation_account`. With the canonical migration-only role baseline, migration 0205 `FORCE ROW LEVEL SECURITY` hides those rows, so a newly enrolled account is not discovered. The Oct 3 production read-only audit found additional inventory policies and fresh spot observations; the canonical-baseline failure is not proof that current production has zero discovery. Deployment requires reconciling its actual policy/membership state with this migration and validating restricted sessions. PR #758 is merged. This branch reconstructs the inventory contract on the `0f6be381a68589d4abd4c8920b5a1fd3f5a02110` main baseline; it is not a verified byte copy of the earlier off-repo repair commits. PR #753 later merged documentation-only at `9af877f5`; that merge adds no migration or runtime code.

Sequence note (Oct 4): Human approved canonical metadata-grants migration 0230. This supersedes only the earlier reservation of migration number 0230 for inventory; the grants migration is copied byte-for-byte from the reviewed canonical source. The existing inventory SQL is byte-identical under its new 0231 filename and remains deferred/HOLD. Because the 0230 grants expose only `observation_revision` and `configuration_revision` to the credential role, PR #759's strict startup projection permits those two metadata columns without requiring them on the pre-0230 baseline; it admits no additional permission or write authority. This sequence decision does not authorize production application or deployment. The historical 0229 runbook remains unchanged as a record of the earlier sequence.

## Scope

- Journal migration `0231_trader_account_observation_spot_inventory_v1` adds a private function owner and an EXECUTE-only caller. The function returns identifier columns for active HTX rows whose stored configuration revision and symbols equal the sealed spot envelope, and raises on invalid input or more than 20 matches.
- The collector calls that function as `waia_account_observation_inventory`. Inventory failure clears the dynamic assignment cache and surfaces `ACCOUNT_OBSERVATION_ASSIGNMENTS_FAILED` instead of continuing as an empty inventory.
- The collector login may `SET` exactly the observer role and the inventory role. Reader and credential logins do not receive the inventory role. The caller role has no table privileges and no ciphertext grant.

## Out of scope

- Changing production state. Migration 0229 was separately applied and verified on Oct 3; inventory migration 0231 remains deferred/HOLD and unapplied.
- Live trading, real orders, Org0 UI, secret values, or enabling a collector in production.
- Widening collector `INSERT`, key decryption, or browser discovery.

## Acceptance

- A restricted inventory read can see a newly enrolled active HTX spot assignment that matches the sealed envelope, and cannot see ciphertext or insert collection-state.
- More than 20 matching rows, a revoked credential, a non-HTX credential, or an inventory error refuses the cycle and drops previously cached dynamic accounts.
- Explicit manifest assignments remain the reserved prefix. A derivatives envelope does not open spot inventory.
- Targeted validation is required on the exact integrated head. Native PostgreSQL proof covers the focused migration and ownership paths, but does not establish whole-PR readiness, scientific readiness, or production readiness.

## Blockers

- [DEE-1015](https://linear.app/deepsense/issue/DEE-1015) is Done. The Linear `blockedBy` relation is still present; the status itself is not a remaining blocker.
- [DEE-961](https://linear.app/deepsense/issue/DEE-961) remains In Review and still blocks DEE-1032. Do not mark this PR merge-ready while that relation is blocking.
- [DEE-1153](https://linear.app/deepsense/issue/DEE-1153) and [DEE-1157](https://linear.app/deepsense/issue/DEE-1157) are Done.
- GitHub PR #758 (DEE-1150) is merged. PR #753 is also merged at `9af877f5` and is documentation-only. These predecessor merges do not resolve the DEE-961 blocker or establish readiness for PR #759.
