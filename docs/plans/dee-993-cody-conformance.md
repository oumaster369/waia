---
integrationIssue: DEE-993
integrationTitle: "Cody JINT=0 reference conformance and evidence versioning"
branch: dee-993-cody-conformance
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build, postgres]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Record exact local commit in Linear; reconcile DEE-992 dependency before publication."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-993: Cody reference-conformance correction

## Authority and dependency

Human explicitly approved the local correction and evidence versioning on 2026-09-12.
No deployment, checkpoints mutation or scientific corpus calculation.
Separate local branch stacked on DEE-992 commit
2ced7a319b419323ef97fd60c4137b12fbe2d2c7. No push/PR/merge performed.
Integration with the unmerged DEE-992 prerequisite must be reconciled before PR.

Ratified narrow mathematical precedence and version map:
[amendment v1](dee-993-cody-amendment-v1.md),
SHA-256 7b8dfb5540833d8e915ecf2456594e366e0fc9c11c8e33f9df6a0732f3d8a09f.
Historical DEE-518 text and diagnostic v1 implementation remain unchanged.

## Work packages

- WP-1: separate corrected JINT=0 kernel and synthetic reference tests.
- WP-2: Gaussian/EWMA trial IDs; harness/Terminal/outer seals and validators;
  Terminal-only cache stage/input/validation; protocol-only local 0207 RLS successor.
- WP-3: targeted numeric/evidence/compatibility tests, local fresh PostgreSQL 17,
  typecheck/lint/build, independent bounded review and factual Linear handoff.

## Scope / non-goals

Preserve all source and empirical Forecast generation, original package/forecast
checkpoint identities, DEVELOPMENT fitting, Brier formula, five mandatory baselines,
B=10000, addressed bootstrap law, positive means, Holm 0.05, PIT and Human gates.
The diagnostic cost report also identifies the current CDF protocol, without
conferring authority or providing an ETA. New baseline/trial evidence is not old
evidence relabeled. The original saved empirical Forecast bytes remain candidates
for reuse only after DEE-991 authentication, original-input and completeness proof.

0207 preserves 0206 and changes only its exact receipt-version/CDF predicates.
It does not update records, disable RLS, change grants or remove Human/tenant joins.
Numbering is local until integration; no production migration was requested/applied.
Local PostgreSQL uses isolated localhost synthetic fixtures; server/checkpoints absent.

## Acceptance

Independent review found no outstanding scoped P1/P2 in numeric correction,
identity/receipt/cache binding and exact migration delta. This is not a full Trader audit.
Local validation: 143 distinct targeted unit tests passed across the final targeted
groups (118 core tests, plus 24 preserved-compatibility and one composition test).
Two stale version/digest expectations were updated to the explicit new contract
and rerun; no assertions or criteria were removed. PostgreSQL 17: full fresh
migration journal through 0207 applied; 54 integration tests passed, two existing
opt-in provisioning cases skipped. Five new exact-protocol probes include a
positive case and negative missing/old/mixed cases under actual SET ROLE.
Typecheck and production Next build passed. Full lint: zero errors; one new unused
test binding warning corrected and targeted lint rerun (existing warnings remain).
Initial build sandbox EPERM on localhost resolved through approved local escalation.
No remote CI or full production rehearsal was run.
Tests include extreme tails, branch boundaries, ordinary bit parity, probability mass,
resealed missing/legacy/mixed receipts for both verdicts, unchanged receipt history,
version-only SQL delta, runner-role positive/negative protocol probes and authority refusal.

## Rollback / boundaries

Local changes can be discarded via a reviewed revert; no production changed.
Never downgrade an admitted receipt, relabel a checkpoint or restart the scientific
calculation as part of rollback. Publication, integration and any production action
remain separate from this local implementation permission.

Reviewability: more than twenty files are required because the same numerical
version boundary must reach baseline IDs, receipt and cache consumers, SQL,
and their existing regression expectations. No unrelated algorithm or UI work
is included; the separate local branch keeps DEE-993's delta reviewable.
