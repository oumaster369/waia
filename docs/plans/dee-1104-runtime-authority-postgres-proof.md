---
integrationIssue: DEE-1104
integrationTitle: "Prove native Postgres Runtime Authority persistence"
branch: dee-1104-runtime-authority-postgres-proof
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1104
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
  nextAction: "Prove native lease/startup transactions and retain mandatory executed CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1104 — native Runtime Authority persistence proof

P10 source tracing on main1bbdb2ab found implemented Postgres Runtime Authority factories without tests invoking them. Existing SQLite and in-memory tests prove their own backends; a Postgres RLS unit inspects migration text, and internal-privilege tests check database grants. None proves the Postgres lease/startup transactions under contention. Preserve all existing implementations and acceptance tests.

## Acceptance

Add actual loopback-Postgres tests for the existing factories and require their execution in the additional capital-authority CI job. Nine cases cover eight independent connections visibly blocked on the tenant advisory lock and exactly one winning lease, readback through a new connection, tenant isolation, expiry/epoch/prior-digest CAS, stale holder fencing, startup rejection, identical replay, content conflicts, append-only triggers and rollback on native head/assessment insert failures. Native check constraints are added inside the failing test transaction and roll back with it; production schema is unchanged. Synthetic tenants retain append-only evidence in the isolated test database.

The result guard retains the seven existing required suites and adds Runtime Authority as the eighth. A local unit invokes the real guard with all eight passing suites and missing/skipped/failed/empty/duplicate variants for each required file. The workflow triggers on the runtime authority sources and new tests. Frozen historical job blocks remain unchanged.

## Validation

Run the nine native cases, all eight required capital suites and the result-report guard without skipped tests. Also run the existing assessment/repository/orchestrator/SQLite lease/RLS units, actual internal-privilege tests, and the new no-skip guard regression. Use pnpm lint, pnpm typecheck, pnpm build, both consumer graph validators, pnpm validate:canon, pnpm validate:pr-governance and rendered PR preflight. Full unit execution is authoritative on exact-head PR CI; do not duplicate the full suite locally.

## Limits and review

No runtime behavior, migration, policy, allowance, economic rule, scientific threshold or trading action changes. Existing supplied trusted adjudication-time semantics are exercised; these deterministic timestamps are not proof of a deployed clock. A new database connection proves persisted readback, not a killed/restarted host. Native insert failure proves transaction rollback, not an entire multi-cycle crash-recovery protocol. This package does not supply source/recovery loaders, lease renewal/deadman, recurring host, external credentials or qualification. P10/DEE-639 remains open, including exact identity and continuous execution admission.

User explicitly delegated technical implementation and merge after checks. Review is self-review, not independent/Human/scientific attestation or standing DEE-653 admission. No production DB/host or pinned C3 changes and no trading activation. Integrate serially after current PR667 acceptance on fresh main; no second PR for this issue.

## Local proof on initial base

171 actual-Postgres tests across9files PASS, including9 new Runtime Authority cases and3 internal-privilege cases. The executed-result guard accepts all8 mandatory capital suites, zero skipped tests.29 unit tests across6files PASS, including9 guard tests exercising41 report variants. Lint has0errors/324existingwarnings; typecheck passes. The first build failed on an unsupported node_modules symlink in the new worktree; frozen offline dependency installation resolved it and the unchanged build passed. Canonical validation then required an explicit Acceptance heading, corrected above. Remaining integration gates and exact-head PR CI must pass before merge; no acceptance inferred from these partial results.

## Combined local acceptance after PR667

Rebased onto accepted main8297142e.171 actual-Postgres tests/9files PASS again; all8 required suites executed with zero skips.63 targeted units/8files PASS including the merged billing integrity/uniqueness regressions. Lint0errors/324existingwarnings; typecheck, build, canon, governance, both consumer graph validators and rendered PR preflight PASS. Reality inventory remains155sources/134consumers/26references with unchanged source/consumer content seals. Exact-head PR CI remains required before merge. No production implementation file is changed by this package.
