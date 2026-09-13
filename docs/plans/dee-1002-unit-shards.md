---
integrationIssue: DEE-1002
integrationTitle: "CI — preserve complete unit-suite coverage with isolated bounded shards"
branch: dee-1002-unit-shards
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, unit, build, canonical-plan, independent-review, exact-head-ci]
approvalGates: [plan-approved, integration-ready, root-publication, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: approved
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Commit approved plan, then implement two isolated shards and fail-closed coverage aggregate."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Scope and approval

DEE-1002 (`93a8229b-2250-40cb-b26e-39fe1eaf8b02`) authorizes this isolated infra
implementation after PR582 hit the unchanged3600s unit watchdog twice. Root
delegated local implementation on2026-09-13 under the user's necessary-engineering
authority. Base is freshly fetched `origin/main`7e0498f7a7e922d35a5c1ca6d61e1bf995e1c76d.
No third blind full-suite rerun. RiskT3 concerns CI acceptance aggregation, not
deployment topology; root retains publication/integration and independent review.

## WP-1 — isolated execution and complete evidence

Change only `.github/workflows/ci.yml`, a minimal `scripts/github` shard-evidence
helper and focused `tests/unit` regressions, plus this plan. Use installed
Vitest2.1.9 native two-way sharding and blob reports, same Node22/pnpm10/config,
full Git history, fresh runner-local SQLite migrations and existing sequential
file execution/isolation. Matrix fail-fast is false; no shared writable fixture
artifacts. Retain70-minute job bound and3600-second existing subprocess watchdog.

Keep job ID `test` and required check name `unit tests` as an `always()` aggregate.
Require every shard success plus both fresh source/run/attempt-bound reports.
Compare exact full file discovery with disjoint shard discovery and actual report
file coverage; missing, duplicate, extra, stale, malformed, failed, cancelled or
skipped shard evidence refuses. Existing intentional skipped tests remain skips
and represented in coverage, never reclassified as executed passing tests.
Preserve complete shard logs and reports without secrets. No report content from
another workflow run/attempt may satisfy this run. Existing build/E2E dependencies
on `test` and all other gates remain unchanged.

## WP-2 — validation and handoff

Inspect actual installed CLI discovery/sharding/blob/merge behavior without running
repository fixtures. Prove the complete discovery partition locally and exercise
bounded synthetic passing/failing/skipped fixtures through actual two-shard/report
CLI paths. Focused regressions must reject inventory/report omissions, duplicates,
extras, stale identities and non-success shard outcomes. Run affected unit tests,
full typecheck, scoped lint and plan checks. Root owns full lint/build and later
publication; exact-head GitHub full-unit/PG/build/E2E/all-required gates and final
independent diff review remain mandatory. No guaranteed duration claim.

## Do not change

No tests removed, skipped or weakened; no pool, isolation, assertion, scientific,
application, schema, dependency, timeout or branch-protection change. No
continue-on-error, retry-on-failure, production/server actions, original data,
main push, PR or merge by this implementation agent. Preserve timeout logs and
all other worktrees/WIP. Rollback is this single isolated CI change, no data repair.

## Validation evidence

Plan-first checkpoint; implementation and gates not yet run. Applicable repository
AGENTS, execution contract, lifecycle, risk tiers and canonical plan rules read.
Full Linear issue read. Source evidence distinguishes complete discovery from
actual execution reports; a green matrix alone is insufficient.
