---
integrationIssue: DEE-1101
integrationTitle: "Commit strategy transitions and Core audit atomically"
branch: dee-1101-promotion-audit-atomicity
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci, postgres-integration]
requiredValidation: [lint, typecheck, build, targeted-unit, postgres-integration, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues:
  - id: DEE-1101
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
  nextAction: "Verify rollback, concurrent CAS and exact idempotency on native databases; integrate serially after DEE-1100."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1101 — atomic strategy promotion and audit

Audit D-06/P07 on main e80f5763 found that the legacy promotion service commits EFFECTIVE v3 before an audit failure escapes. Request, confirmation, effectiveness, cancellation and demotion all use separate state/audit writes. The console already has an outer transaction; native factories also serve legacy HTTP and CLI composition without it. Work starts from a4c2f777 and integrates after the already queued DEE-1097–1100 packages.

## Result and boundaries

Each service mutation is one native persistence-and-Core-audit transaction. The shared service receives a required atomic commit port, never two independent write callbacks. SQLite writes synchronously inside its native transaction; PostgreSQL uses a native transaction or a savepoint inside the caller's transaction. An executor lacking transaction support fails closed before a mutation. State machine, cooling-off, version and scientific evidence rules remain unchanged.

An exact idempotency retry returns the saved record, including after a competing insert wins. A changed content digest or actor for that key is a conflict. A unique-key race is recovered only after rollback and rereading the committed winner. Audit failure propagates and leaves neither write committed. A stale command cannot produce a duplicate audit. A forced interleaving also proved that a future expected revision could attach to another command's newly committed state; the service now binds the version used to derive its patch to the caller's expected version before entering the write transaction.

Adversarial review found an adjacent proven CAS defect: the PostgreSQL repository ignored the affected-row result, so two transactions that read v1 could both report successful confirmation and append audits although only one changed the row. A row-lock-controlled test reproduced two successes. Both native repositories now require exactly one affected row; the loser fails without an audit. This minimal repair belongs to the same atomic transition result.

## Acceptance

Five audit-injection cases first failed on the old native PostgreSQL service: request and each FSM transition must roll back on append failure, then an exact valid retry commits one audit. Verify the same behavior on SQLite. Six concurrent exact requests result in one record/audit; conflicting payload is denied. Two concurrent confirmations use real distinct database connections and a blocking row lock; observe both updates waiting before releasing it, then exactly one succeeds and one fails. A singleton one-connection pool is insufficient concurrency evidence.

An executor without transactions refuses writes. An outer transaction rollback removes both nested state and Core audit, preserving console transaction composition. Existing native PostgreSQL promotion parity, research provenance and console request-revision tests remain green. Synthetic evidence fixtures deliberately do not qualify a strategy or represent Human attestation; the existing provenance-disable option is limited to those tests. Production defaults remain enabled.

## Files and validation

Change promotion-service.ts and the two validation-gate repositories, plus dedicated native rollback/concurrency fixtures. Add the actual-PG suite only to the additional capital-authority job and its no-skip report guard; frozen historical jobs remain intact. Trigger this workflow for future validation-gate, atomic-promotion helper and native regression changes as well. No schema migration.

Run pnpm lint, pnpm typecheck, pnpm build, targeted unit and actual local PostgreSQL suites, both consumer graph validators, pnpm validate:canon and pnpm validate:pr-governance. Exact-head PR CI is authoritative for the full suite. No production database is used for tests. Retain combined Risk-bootstrap and actor-authorization mandatory suites when integrating the queued branches.

## Review, exclusions and rollout

Adversarial self-review checks transaction ownership, CAS at write time, audit failure/rollback, idempotency collision, original actor and org, no await inside SQLite transaction, unchanged read-only paths and no exchange calls. This is self-review, not independent or Human attestation. Session-specific user authority permits technical self-acceptance and merge after all checks; it does not claim standing DEE-653 admission or scientific qualification.

No policy, ADR, financial formula, trading threshold, account ownership, live flag, promotion state or scientific evidence is changed in production. Actual promotion, live enable and financial effects remain operator actions. No deployment to the pinned C3 producer. Legacy historical orphan audits are not fabricated or backfilled; any discovered old mismatch requires evidence and a separate repair plan. Wider runtime lease, qualification and activation gates remain open.

## Local evidence — 2026-09-25

Initial five native-PG audit failures were RED before the atomic port. A later multi-connection row-lock probe was RED with two successes before affected-row validation; the earlier single-connection concurrency test was not sufficient evidence. A forced future-revision interleaving was also RED (unexpected successful duplicate confirmation) before binding the derived patch version.

Final actual PostgreSQL80 tests/8files PASS, including10 promotion atomicity/CAS/idempotency/outer-rollback cases, promotion/research parity and the existing4 capital suites. The5 mandatory-suite report guard confirms executed proof with no skips. Unit43tests/7files PASS, including7 native SQLite atomicity cases, operator/live authorization, admin routes and frozen observation CI contract. Lint0errors/324existingwarnings, typecheck/build/canon/governance/bothgraphs PASS. No Reality content seal change is needed on the current base. Exact-head combined-tree PR CI is still required after serial rebase; this local evidence is not merge or scientific admission.
