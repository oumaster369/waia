---
integrationIssue: DEE-654
integrationTitle: "AI-TRADER — Generic three-time PIT and trust-as-of foundation (Split A)"
branch: dee-654-generic-pit-trust-as-of
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, postgres-ci]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-targeted, postgres-integration, pr-governance]
approvalGates: [human-split-a-ratification, integration-ready, independent-adversarial-review, dee-653-exact-head-admission]
includedIssues: []
deferredIssues: [DEE-620]
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP4
  completedWorkPackages: [WP0, WP1, WP2, WP3]
  remainingWorkPackages: [WP4]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-08-19"
  blockedReason: null
  nextAction: "Publish one PR and await exact-head CI/admission."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
humanApproval:
  authorizedAt: "2026-08-19"
  authorizedBaseMain: 5e5da47c8a994a84379cad1b7472206186971741
  authority: "Human directive narrowing DEE-654 to Split A only"
---
# DEE-654 — Generic three-time PIT and trust-as-of foundation
Human-ratified Split A on clean `origin/main@5e5da47` containing DEE-653 / PR #468. Linear
DEE-654 is `In Progress`, label `backend`; DEE-620 stays open. Canon: AI-TRADER Steps 1–2.
## Contract
- Keep three UTC instants separate, explicit, valid, and no later than the anchor; assume no universal ordering.
- Resolve only an org/source-scoped complete visible prefix; every ambiguity returns typed `UNKNOWN`.
- Persist content-addressed, append-only `TrustAsOfReceiptV1`; mutable status and downstream authority are excluded.
- Preserve V1 trust/Observation digests and SQLite paths; apply no production SQL.
## Exact file map
- Contract: `lib/trader/mi/pit-chronology-v1.ts`, `lib/trader/mi/trust-as-of-v1.ts`.
- Postgres: `lib/trader/mi/trust-as-of-repository-postgres.ts`, `db/schema.postgres.ts`, migration `0152` + journal.
- Proof/memory: two focused tests, this plan, DEE-654 migration note, DEE-64 tracker, `db/AGENTS.md`.
Target: 10–14 files / approximately 700–1,050 changed lines. Stop before PR if correct work
materially exceeds it or exposes semantic/security ambiguity.
## Work packages
- WP0: verify base/canon/issues, narrow Linear, map repository, publish plan.
- WP1: implement strict chronology, canonical ordering, complete-prefix resolution, typed `UNKNOWN`, stable digest.
- WP2: add nullable compatibility and org-scoped receipt persistence with FKs, guards, and deny RLS.
- WP3: prove replay, ambiguity, tenant isolation, append-only/RLS and update only listed memory.
- WP4: run all gates and adversarial review; publish one PR; merge only on fresh exact-head admission.
  Rollback is a revert PR/separate operator migration; DEE-654 applies no destructive/production SQL.
