---
integrationIssue: DEE-790
integrationTitle: "Deterministic Authoritative Run-Chain Pause Proof"
parentIssue: DEE-755
branch: dee-790-authoritative-run-chain-pause
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  - focused-fhv-pause-suite
  - deterministic-source-proof
  - typecheck-and-scoped-lint
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
  completedWorkPackages: [DEE-792, DEE-791]
  remainingWorkPackages: []
  blockedReason: null
  nextAction: "Obtain zero-P1/P2 exact-head review, then publish one stacked PR to the DEE-781 branch and require all CI plus DEE-653 PASS."
provenance:
  createdFrom: controller-authorized-test-quality-remediation
  authoritativeBase: b050f176d0c3aa677de2a10a6fe85b14fb3fa87d
  admissionCommit: 7103288d2adf51f2eeca604f7461972397d71547
  admissionManifestDigest: 49bc30bb669081682a4b85b79dbd66e42da1c56f2f836a2fbe67c7f84bae625d
---

# DEE-790 — deterministic authoritative-run-chain pause proof

## Admission

- Exact stacked base: PR #514 head `b050f176d0c3aa677de2a10a6fe85b14fb3fa87d` (`dee-781-fhv-deterministic-pause-harness`).
- Dependency order: this train merges only into the DEE-781 branch; PR #514 is then re-reviewed and rerun against `main` before any main merge.
- One isolated test-only branch/worktree, one admission-first manifest, one PR and one squash merge.
- DEE-792 replaces the fourth legacy external timing-race pause consumer with the already-ratified default-off `testOnlyPauseAfterCycles` boundary.
- DEE-791 adds a bounded source/proof check and records focused/full-suite closure.
- No production file, assertion, scientific formula, holdout, security, live or capital semantic may change.

## Required proof

The authoritative-run-chain test must preserve parity, digest, gap, duplicate and evidence-health assertions while removing external polling and pause-request timing. Focused FHV tests, the proof script, literal fresh-migrated full SQLite, exact-head independent review, authoritative CI and DEE-653 must all pass before squash merge.

## Acceptance

1. The fourth legacy FHV consumer uses the existing default-off deterministic cycle boundary and no external polling or pause-request race.
2. Parity, digest, gap, duplicate, cycle-count and evidence-health assertions remain intact.
3. No production, scientific, holdout, security, live or capital semantic changes are present.
4. Focused proof, typecheck, lint, canonical validation, full fresh SQLite, independent review, authoritative CI and DEE-653 all pass before the stacked squash merge.

## Rollback

One revert PR of the squash commit. No deployment, live trading or capital action is authorized.
