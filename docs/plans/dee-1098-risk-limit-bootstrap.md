---
integrationIssue: DEE-1098
integrationTitle: "Preserve Risk limits on concurrent paper initialization"
branch: dee-1098-risk-limit-bootstrap
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1098
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: in-progress
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: implementing
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Verify native transactional initialization, then integrate after DEE-1097."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1098 — preserve Risk profiles at startup

Audit D-03/P04 on main e80f5763: paper dependency creation unconditionally upserts defaults even with the loop disabled. A strict synthetic maxNotional1 becomes10000, with a version bump. Replacing this with the previous getOrCreate alone is insufficient: its second read can see a concurrent operator insert and then overwrite it via persistLimitsChange.

## Result and boundaries

An enabled, completely configured loop may initialize only a missing profile. Native PG/SQLite insert-on-conflict-do-nothing identifies the sole creator; only that transaction writes a creation audit. The loser reads the committed winning profile. No default UPDATE exists in the initialization path. Both creation and audit roll back together. PostgreSQL executors without a transaction method fail closed on missing-profile initialization; reads of existing profiles stay compatible. SQLite audit injection is synchronous by type, consistent with its native transaction boundary.

Disabled/incomplete bootstrap does not initialize a profile. Existing profiles retain values/version/timestamps/audit. If initialization throws, startup closes its client and preserves the error. The touched Risk service also preserves userId through membership checks; the other17 audited services remain P06. Background org-only service use remains explicit and unchanged. No assertion of remote HTTP leakage or global isolation closure.

Operator upsert concurrency/CAS and atomicity are separate from default initialization and remain in the safety audit matrix. No defaults, thresholds, permissions, fee/HWM/settlement, policy, schema or scientific evidence changes. No live activation/venue effect. C3 stays pinned and untouched.

## Acceptance and validation

Real isolated PostgreSQL: disabled/incomplete zero writes; repeated enabled/disabled startup over strict profile leaves it identical; first enabled initialization; eight concurrent initializers; uncommitted operator insert wins (observe actual PG lock wait); injected audit failure rolls back; missing transaction refuses before insert. SQLite: repeated/concurrent initialization, rollback and outsider denial, existing evaluator/service/worker regressions. The additional capital-authority CI job includes this real-PG suite and report gate rejects skips; frozen historical jobs remain untouched.

Run pnpm lint, typecheck, build, targeted tests, actualPG proof, both consumer graphs, canon and PR governance; full exact-head PR CI is authoritative. Never use production database for these tests. Local infrastructure recovery started Docker and created a fresh isolated PG16 on127.0.0.1:55525 because the prior named container no longer exists; no other container reset.

## Review and rollout

Adversarial self-review: prove no initialization UPDATE, no audit on losing conflict, no phantom success after audit failure, no numeric conversion or policy widening, no transaction around network I/O, preservation of actor membership checks. This is self-review, not independent/Human attestation. User explicitly delegated technical self-acceptance, PR/merge after checks and non-trading deployment. Financial actions remain operator-only. Integrate after PR#661, refresh reviewed source seals for the exact combined tree, verify deployment separately; no C3 host rollout.

## Local verification — 2026-09-25

All64 tests across5 required real-PG suites PASS and report guard accepts executed proof. Of these,9 cover new bootstrap behavior. Targeted unit54/7files PASS, including native SQLite concurrency/rollback, outsider denial, engine and frozen CI contracts. Lint0errors/324existingwarnings, typecheck/build/canon/governance and Execution graph PASS. Reality source set unchanged; consumer content seal refreshed solely for reviewed build-worker-deps.ts, with134consumers and25connector references unchanged. No deployment or trading action performed.
