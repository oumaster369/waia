---
integrationIssue: DEE-1010
integrationTitle: "feat(trader-ops): add fail-closed H2 one-step migration operator"
branch: dee-1010-h2-one-step-migration-operator
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation:
  [lint, typecheck, targeted-unit, targeted-postgres-integration, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Complete canonical validation, commit, publish one PR to main, and stop at the Human squash-merge gate."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
  parentIssue: DEE-1007
---

# DEE-1010 — H2 one-step migration operator

## Scope

Build one Human-operated PostgreSQL migration surface for exactly one explicitly selected
Trader H2 step: `0205`, `0206`, `0207`, or `0208`. The operator binds pinned Git source,
the complete live migration prefix, private ceremony attestations, bounded locks, exact SQL
and journal insertion in one non-retrying transaction, migration-specific catalog checks,
and a read-only post-commit receipt.

## Protected boundaries

- Never apply a migration from this implementation task.
- Never connect to production, the Execution Server, or C2/C3.
- Never accept `0209`, infer a latest migration, loop, retry DDL, or auto-advance.
- Do not edit migration SQL, `db/migrations_postgres/meta/_journal.json`,
  `db/schema.postgres.ts`, `lib/trader/observability/fhv-v2-postgres-schema-preflight.ts`,
  `lib/auth/session-user.ts`, Trader runtime, R/P2, or scientific code.
- Integration tests are opt-in and must hard-require an owned loopback PostgreSQL fixture.

## Work packages

### WP-1 — immutable contract

- Pin baseline `0204` and steps `0205`–`0208` by commit, blob, SHA-256, journal identity,
  predecessor, affected relations, writer identities, and catalog verifier.
- Implement hardened Git source, journal, fresh Ed25519-signed attestation, target and receipt
  assertions.

### WP-2 — one-step operator

- Add the explicit CLI and verify-only mode.
- Use one reserved direct/session connection, bounded advisory/table locks, one
  `SERIALIZABLE` transaction, exact SQL bytes and exact journal insertion.
- Verify immutable exact catalog digests before commit and reconnect into one read-only
  repeatable snapshot after commit.

### WP-3 — evidence and handoff

- Add unit and owned-local PostgreSQL integration tests.
- Add the Human H2 operator runbook.
- Complete canonical validation and open one PR to `main`; stop at Human squash-merge.

## Acceptance

- Only `0205`–`0208` are accepted and every invocation handles one step.
- Commit/blob/SHA-256 and exact predecessor prefix are mandatory.
- Missing or unsafe ceremony evidence, target mismatch, active writers, lock timeout,
  journal contradiction, catalog contradiction, or any `0209` evidence fails closed.
- SQL and journal insertion are atomic; there is no retry or next-step execution.
- An uncertain commit outcome permits only read-only `--verify-only` classification.
- Receipts contain digests and identities only, never credentials or attestation contents.
