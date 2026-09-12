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
  nextAction: "Publish Cody-only PR against merged Brier657914b1 after governance preflight; authoritative full CI still required. No deployment or scientific execution."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-993: Cody reference-conformance integration

## Canonical publication checkpoint — 2026-09-12

The user subsequently authorized autonomous necessary engineering and merge work,
then resumed the September12 handoff. The earlier local-only task statement below
records that initial phase, not an assertion that publication already occurred.
No production or original scientific execution is included in this publication.

Brier PR580 merged as657914b1d6b4b897619cbfaef5d558ae1378efc9 after all24 checks
passed. Its Git tree exactly matches reviewed Brier740ba4f1. Root preserved the
original Cody branch at `dee-993-cody-presquash-20260912` (d5967bbc), then rebased
the four Cody-only commits onto that squash before first publication. Canonical
head26cfdcba80beffb11425b8426031f29726d850d6 has exactly the same full Git tree
f979f1d2bcae35b9c4c07ac75fadba1b1757f897 as d5967bbc; no implementation changed.
This checkpoint subsequently changes only this plan, not the reviewed source.

Local71focused and10actual restricted-role shared PostgreSQL17 tests PASS, plus
full typecheck, full lint (0errors,307existing warnings) and default Turbopack
application build with private synthetic SQLite fixture. No redundant full local
unit run: exact-head PR CI is authoritative. Logs include
`/private/tmp/waia-cody-740-integration-focused.log`,
`/private/tmp/waia-cody-740-shared-pg17.log`, `/private/tmp/waia-cody-build.log` and
`/private/tmp/waia-cody-full-lint.log`.

Independent read-only review of exact740ba4f1..d5967bbc found no P1/P2. It checked
the ratified amendment hash, JINT=0 huge-tail exit against Netlib CALERF,
baseline/trial/harness/Terminal/cache/outer identity propagation, strict migration
prefix and preservation of0206 tenant/request/proposal/Human predicates in0207.
Reviewer did not rerun tests or PostgreSQL. The protocol-positive PG test uses
an extracted exact predicate on an RLS probe table, not a full real admitted
receipt fixture. Scientific reuse/admission and whole-Trader acceptance remain
separate; old cache or score evidence cannot become current by this merge.

Reviewability rationale:26files/about900changed lines exceed the recommended
size, but numerical correction and every versioned consumer/RLS/cache negative
must land atomically to avoid accepting mixed evidence. Most changes are focused
tests, the additive175line exact-predicate migration and the two plans; no unrelated
feature is included. One revert restores this same coupled protocol boundary.

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

### Resumed dependency compatibility check, 2026-09-12

Normally merged PR580's pending head740ba4f160388df8ee4e6712fdeee3b6e6d5d4a1
into this local unpublished branch, preserving9ab196cd and the original Cody
branch. This is preparation, not proof that Brier has merged or publication
readiness. After the actual Brier squash, reconcile the Cody-only delta onto
that canonical main and repeat affected exact-head checks.

Inherited the Brier regression fixes without changing migration SQL, scientific
semantics or consumer discovery. The only new expectation is the explicit0207
entry in the Forecast migration-extras list (ratified0148 identity unchanged).
The missing expectation reproduced as1 failed/7 passed before the fix.
Afterwards71 focused tests across7 files passed, including exact migration
identity, Reality consumer digest, required207 preflight, numeric Cody and
receipt-version boundaries. Typecheck and targeted ESLint passed.

The actual shared PostgreSQL17 compatibility file passed all10 tests,0 skipped,
against a new isolated localhost fixture on55478. It applied fresh0000..0207
and204-to-current upgrade under non-super/non-bypass owner, preserved scoped
credentials/snapshots and RLS, and rejected corrupted/unknown migration states.
Fixture owner/port/label were inspected before use; it was stopped afterwards.
Logs: local waia-cody-740-integration-focused.log and
waia-cody-740-shared-pg17.log. No original data, production or scientific
calculation was accessed. Independent static comparison confirmed that the
Cody delta requires no extra Reality fingerprint beyond the Brier fix.

Local changes can be discarded via a reviewed revert; no production changed.
Never downgrade an admitted receipt, relabel a checkpoint or restart the scientific
calculation as part of rollback. Publication is governed by the current authority
above; production actions remain separate and subject to their technical gates.

Reviewability: more than twenty files are required because the same numerical
version boundary must reach baseline IDs, receipt and cache consumers, SQL,
and their existing regression expectations. No unrelated algorithm or UI work
is included; the separate local branch keeps DEE-993's delta reviewable.
