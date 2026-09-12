---
integrationIssue: DEE-993
integrationTitle: "Cody JINT=0 reference conformance and evidence versioning"
branch: dee-993-cody-integrated
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
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Root integrator to review the isolated branch and determine publication/readiness; no server or scientific execution performed here."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-993: Cody reference-conformance integration

## Authority and dependency

Human explicitly approved the local correction and evidence versioning on 2026-09-12.
No deployment, checkpoints mutation or scientific corpus calculation.
Original local implementation was stacked on DEE-992 commit
2ced7a319b419323ef97fd60c4137b12fbe2d2c7. The original branch remains preserved.
This isolated integration branch starts at the corrected Brier commit
683424c3b9011d6a185e7e7bf89fd5e06de1ed89 and cherry-picks only the approved Cody
commit 1b1720a38a4468afe77ba25b261da15ac45ffed5 as dfae5bfd.
No push/PR/merge or server operation is part of this local integration task.

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
- WP-4: reconcile the mandatory schema preflight through 0207 and focused
  negative cases on the corrected Brier base; preserve 0205/0206 requirements,
  reject unknown future migrations, and run focused local units/typecheck.

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

The following evidence describes the original Cody implementation, before this
isolated integration. Integration validation is recorded separately below.

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

### Local integration validation

Schema admission now requires the complete exact-hash prefix 0000..0207. Neither
0205 nor 0206 alone authorizes the current Cody runtime; removing either prior
migration still refuses even when 0207 is present. 0207 is not optional, and 0208
remains unknown. Existing account-observation migration tests continue to check
0204/0205 refusal and full-current-journal acceptance without weakening RLS,
role restrictions, credential isolation or data-preservation assertions.
The ratified amendment bytes and 0207 SQL semantics remain unchanged.
141 focused unit tests passed across 11 files, including corrected Cody, Brier,
schema admission and shared receipt/harness consumers. Typecheck passed. Canonical
validation passed for this plan and the unchanged ratified amendment. No full suite,
PostgreSQL server execution, deployment or scientific corpus evaluation was run.
The account-observation journal/SQL packaging check passed with its three PostgreSQL
cases explicitly disabled. Targeted lint passed for the three preflight/test files.

Root integration follow-up at `eff02ea6a6cefd1aba65992815f2fcdbe9755e80`:
the same account-observation migration file was run with `DEE960_LOCAL_PG17=1`
against the isolated localhost PostgreSQL 17 fixture. All four tests passed,
including the three previously disabled cases: fresh chain, actual Drizzle
migrator through the current 0207 journal under a restricted owner, and additive
upgrade/data/grant preservation. Log: local `waia-dee993-integrated-pg17.log`.
This is not production migration or a claim that the full regression suite ran again.

### Current publication authority

The latest Human instruction on 2026-09-12 authorizes autonomous necessary work
toward historical readiness and supersedes the earlier local-only publication
boundary for this already ratified correction. Prepare one DEE-993 PR only after
the DEE-992 dependency is reconciled into main; exact-head CI and independent
review remain required. No result grants scientific, Human-ratification,
private-account, capital or blind-holdout authority. This local preparation has
not changed production or started a scientific corpus calculation.

## Rollback / boundaries

Local changes can be discarded via a reviewed revert; no production changed.
Never downgrade an admitted receipt, relabel a checkpoint or restart the scientific
calculation as part of rollback. Publication is governed by the current authority
above; production actions remain separate and subject to their technical gates.

Reviewability: more than twenty files are required because the same numerical
version boundary must reach baseline IDs, receipt and cache consumers, SQL,
and their existing regression expectations. No unrelated algorithm or UI work
is included; the separate local branch keeps DEE-993's delta reviewable.
