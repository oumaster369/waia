---
integrationIssue: DEE-793
integrationTitle: "FHV Deterministic Harness Governance-Valid Replacement"
parentIssue: DEE-755
branch: dee-793-fhv-governance-replacement
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - exact-source-patch-and-tree-equivalence
  - focused-fhv-pause-suite
  - deterministic-source-proof
  - typecheck-lint-build
  - one-full-fresh-migrated-sqlite-suite
  - independent-exact-head-review
  - authoritative-ci-and-dee-653
approvalGates:
  - test-only-scope-preauthorized
  - integration-ready
  - dee-653-exact-head-admission
state:
  status: frozen
  currentWorkPackage: null
  completedWorkPackages: [DEE-794, DEE-795]
  remainingWorkPackages: []
  blockedReason: null
  nextAction: "Run focused and complete exact-head gates, obtain independent review, then publish the replacement PR for authoritative CI and DEE-653."
provenance:
  createdFrom: controller-authorized-governance-valid-replacement
  authoritativeBase: 0fefa5f71d1cf38e065419781c1e9971804487c2
  admissionCommit: cc16506417557cbc5a73292bb39ff4407729d73f
  admissionManifestDigest: 1d4e7e2d0a2d706bd55791143c1b4d97765a6507d0d6ba7737c89682b3edff70
---

# DEE-793 — governance-valid FHV replacement train

## Admission

- Exact base: current `origin/main` `0fefa5f71d1cf38e065419781c1e9971804487c2`.
- One isolated branch/worktree, one admission-first umbrella manifest, one replacement PR and one squash merge.
- DEE-794 replays the reviewed DEE-781 tree byte-for-byte.
- DEE-795 then replays the reviewed DEE-790 tree byte-for-byte.
- The old PR #514 remains unmerged and is closed as superseded only after replacement publication and evidence transfer.
- No production caller, production behavior, assertion, scientific formula, security, holdout, live, execution or capital semantic may change.

## Required proof

Exact patch/tree equivalence to DEE-781 reviewed head `b050f176d0c3aa677de2a10a6fe85b14fb3fa87d` and DEE-790 reviewed head `c7f60423c6ba3ca32e5d498e2f6830ceeb93f2d0` / combined tree `ce54f3dcce21707c13884d1e67722350abc77d90`; focused deterministic pause tests and source proof; typecheck, lint and build; literal full fresh-migrated SQLite; fresh independent exact-head review; authoritative CI and DEE-653.

## Acceptance

1. The default-off test-only cycle boundary and all four legacy consumers are byte-identical to their reviewed source patches.
2. Every parity, digest, frontier, timeout, tamper, canvas, gap, duplicate, cycle and evidence-health assertion remains intact.
3. The frozen manifest maps every base-to-head file and child commit without changing the governance validator.
4. All required gates pass on the exact immutable replacement head before squash merge.

## Frozen evidence

- exact source-file tree equivalence to combined reviewed head `ce54f3dcce21707c13884d1e67722350abc77d90`: PASS;
- focused deterministic FHV suite: 5 files / 14 tests PASS;
- bounded authoritative-run-chain proof: PASS;
- typecheck, lint and production build: PASS;
- literal fresh-migrated SQLite: 878 files / 5109 tests PASS, 0 failures, 426 skipped;
- fresh exact-head independent review and authoritative CI/DEE-653 remain required before merge.

## Rollback

One revert PR of the replacement squash commit. No deployment, live trading or capital action is authorized.
