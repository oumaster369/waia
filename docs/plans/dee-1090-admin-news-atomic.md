---
integrationIssue: DEE-1090
integrationTitle: "Atomic news evidence persistence"
branch: dee-1090-admin-news-atomic
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration, collector]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1090
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Require every exact-head CI check, guarded squash and actual merged-main news collection acceptance."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1090 — atomic news persistence

Final production review after #656 found a historical duplicate-key news incident. Its exact historical cause is not established by the redacted message alone. Current `createPostgresCollectorStore.applyNews` does demonstrably separate the item, version and current-version pointer writes, using a plan read before persistence. Prove the failure with real PostgreSQL before claiming it fixed.

## Result and boundaries

Serialize writes for one existing news identity, re-read its saved head inside the same transaction, and atomically append the version and pointer. Identical retries create no duplicate version. A delayed older observation cannot replace newer saved content. A failed item/version/pointer write rolls back the whole operation. Keep saved history, dedupe identity, source/observation timestamps, schema and schedule unchanged. Do not silently repair or rewrite historical orphan records.

No financial rules, money arithmetic, commission/HWM/settlement, authorization, trading, Risk/Guardian, holdout, external runtime or policy changes. User delegation covers this operational fix and self-acceptance/merge/deployment; no independent review or policy ratification is claimed. This is a single issue, not a multi-issue integration train.

## Acceptance

Real disposable PostgreSQL demonstrates concurrent identical inserts and concurrent changed plans without unique violations, contiguous versions with the newest observation current, and rollback of injected version/pointer failures. Existing collectors, cold-start, retention and canonical news-read tests stay green. Review both pinned graphs; update a content pin only if the actual inventoried diff requires it. Require lint, types, build/OpenNext, canon, governance, rendered PR preflight and every applicable exact-head GitHub check before guarded squash. Build/deploy exact merged main, keep collectors enabled, and verify subsequent scheduled news success and the authenticated news surface.

## Verification

All five new real-Postgres regressions failed on the previous implementation: overlapping insert/edit plans hit unique constraints, injected failures left an item or an uncommitted head version behind, and a delayed plan hit the existing version key. After the repair, all 36 focused unit/real-Postgres tests pass. Both graph validators pass without inventory changes. Production read-only inspection before rollout found 60 news items, zero missing current versions and zero versions ahead of their pointer; no production data repair is required or performed. Exact historical root cause of the prior redacted unique-constraint incident remains unproven; this repair addresses the now-reproduced current persistence failures.
