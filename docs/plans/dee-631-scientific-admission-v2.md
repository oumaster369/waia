---
integrationIssue: DEE-631
integrationTitle: "Conjunctive scientific admission receipt v2"
parentIssue: DEE-601
branch: dee-631-scientific-admission-v2
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-ci]
requiredValidation:
  - focused-known-answer-and-negative-tests
  - typecheck
  - production-build
  - one-full-fresh-migrated-sqlite-suite
  - canonical-and-pr-governance
  - independent-exact-head-review
  - authoritative-postgres-and-dee-653
approvalGates:
  - human-ratified-dee-631-scope
  - t3-scope-preauthorized
  - exact-head-independent-review
  - dee-653-exact-head-admission
includedIssues: [DEE-740, DEE-739]
state:
  status: locally-validated-awaiting-pr
  currentWorkPackage: null
  completedWorkPackages: [DEE-740, DEE-739]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 3b64844efcb2b2fb85284047210211de7601af79
  lastValidationAt: "2026-08-27T02:00:00+03:00"
  blockedReason: null
  nextAction: "Complete exact-head review/full SQLite, publish one PR, then require authoritative CI/PostgreSQL and DEE-653."
provenance:
  createdFrom: human-ratified-dee-631-scope
  sourceThread: 01a019c0-8940-7272-bc9c-6b330e6bf0f2
  authoritativeBase: f07ddd74cc79f098a86aac269a2b0e0a65410b78
  admissionAudit: "Fresh origin/main, Linear dependency/duplicate/ownership and producer/consumer/replay/persistence/test surfaces admitted before implementation commit."
---

# DEE-631 — Conjunctive scientific admission receipt v2

## Frozen API and invariants

1. A predictive terminal receipt binds the exact DEVELOPMENT dataset, target grid, evaluation partition, common anchors, mandatory baseline family, positive mean improvements, one-sided Holm FWER results, package generation/content, runtime and scoring identities.
2. `QUALIFIED` requires every mandatory baseline available, a positive mean improvement against every baseline and every Holm hypothesis rejected. `NO_CHALLENGER_QUALIFIES` is terminal-valid but never admitted.
3. Scientific admission is conjunctive: exact predictive qualification, exact qualified K/M convergence and an exact Human `RATIFIED` receipt for selected K, M, alpha and package identities must agree.
4. Content-addressed reconstruction rejects missing, mismatched, stale and cross-organization replayed evidence.
5. Existing holdout seals remain untouched. Decision, Risk, production/live and capital semantics are excluded.

## Work packages

- DEE-740: conjunctive predictive/KM/Human-ratification authority.
- DEE-739: durable append-only persistence and fail-closed validation evidence.

## Acceptance

- Known PASS, predictive failure, Holm failure, missing baseline, KM failure, digest mismatch and no-challenger cases are deterministic.
- Durable receipt cannot be constructed from KM convergence alone and rejects stale/cross-org replay.
- Focused/negative, compile/build, fresh-SQLite, exact-head review, PostgreSQL/CI and DEE-653 pass before squash merge.
