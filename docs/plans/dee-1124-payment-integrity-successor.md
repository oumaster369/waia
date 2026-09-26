---
integrationIssue: DEE-1124
integrationTitle: "AI-TRADER — integrate reviewed payment integrity on the accepted billing base"
branch: dee-1124-payment-integrity-successor
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, unit, build, canon, pr-governance, integration-train-manifest]
approvalGates: [plan-approved, t3-scope-preauthorized, integration-ready, bounded-controller-merge]
includedIssues:
  - id: DEE-1116
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: pending
  - id: DEE-1117
    role: work-package
    completionPolicy: manual-at-integration-ready
    status: pending
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1, WP-2, WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Commit and validate this admission, then stop for root's exact admission check before either child import."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: DEE-1123
---

# DEE-1124 — Payment integrity successor on accepted billing base

## Admission and current boundary

Root created DEE-1124 (`129a6b88-87f0-4e32-ac6b-3ef74df7641d`) under
DEE-638 and adopted the exact successor contract SHA-256
`10d419b31a84265e057802c42c74f7de8c0a0f94915de4d0e9c127aad6aae4db`
before this branch or its admission files. M01 independently accepted that exact
bounded design; this is not final implementation acceptance. The user authorized
technical corrections, tests, checked delivery and coherent consolidation; financial,
ADR, empirical and live gates remain unchanged.

The branch starts at accepted main `56ee65f00f3b19858d57ea8f3947d2867822e9ac`.
This first commit contains only this plan and its adjacent admitted manifest. No child
is delivered in this train yet. Original implementations and prior tests predate this
admission; their preserved source is `50171ca7afffb0c710bd5aafc32a896333e857ae`.
The original `dee-1123-payment-proof-integration` branch and unmerged PR680 remain
preserved. Root owns issue reparenting, successor publication and eventual superseded
PR closure; no current Linear reparenting or PR closure is asserted here.

The admitted manifest is
`docs/plans/dee-1124-payment-integrity-successor.integration-train.json`.
Evidence is recorded outside the repository under
`audit-ai-trader-full-2026-09-25/evidence/dee-1124/accepted-base-56ee65f0/`.
After admission validation and its immutable commit receipt, stop for root's exact
admission check. Child import execution requires the next explicit root instruction.

## Context

The reviewed payment train at `50171ca7afffb0c710bd5aafc32a896333e857ae` repairs complete
payment observation, exact atomic amounts, manual decimal equality and HTTP cooling
ownership. Its valid pre-import admission `c016700b767b3f2f09fb56619edf24e3c6c6397a`
descends from21a60. Main advanced independently to accepted
`56ee65f00f3b19858d57ea8f3947d2867822e9ac` after PR679. Existing train validation requires
the exact current PR base to precede admission and every mapped import; normal merge
cannot alter that ancestry. Historical-base validation passes; exact-current-base
validation refuses admission and all four mapped imports. No payment-code regression
or production incident is asserted by this governance refusal.

This successor starts at **exact56ee65f0**, commits its own approved/admitted plan and
manifest **before any import**, then imports only the same reviewed child files in two
serialized waves. Original work and reviews predate this new admission and remain
historical evidence. New mapped commits, cumulative tests and final acceptance belong
to the successor. Root reserves main at56ee until this train's accepted merge, keeping
other engineering parallel but avoiding another invalidated admission history.

## Goal and single delivery result

Deliver the existing payment evidence → reconciliation boundary as one coherent code
integration on the accepted billing base: only a complete, consistently sourced bounded
observation can advance payment/checkpoint effects; token atomic amounts remain exact;
manual reconciliation uses exact decimal equality without changing the stored fee text;
untrusted HTTP callers cannot override the server cooling interval. Existing confirmation,
finality, account/tenant, authorization and ledger/settlement policies remain intact.

This is repair/integration of existing rules. It does not create paid status, issue an
invoice, move funds, execute a provider call, ratify a quorum scheme, or authorize live
trading during implementation or acceptance.

## WP-1 — exact reviewed observation import and cumulative proof

Only after valid committed successor admission, import the six DEE1116 paths listed
below from **50171ca7**. Their historical original source is
`2af4d14a5caaaac7db28c98343cefce0b9c74265`, source patch base1a59b31b; original train
import601baeaa followed the old admission. Those SHAs are provenance, not new mapped
implementation commits. New imports must descend from the new admission.

Preserve documented exact-block enumeration and complete bounded pagination, fixed
endpoint/query scope, response-envelope/event/provider validation, whole-observation
provider consistency including watcher outer tip, no partial effects/cursor advancement,
and exact six-decimal BigInt atomic amounts. Explicit quorum=true continues to refuse
unsupported configuration before effects; defaultfalse remains the existing policy.
No new bounds, rescan/window/finality defaults or retry semantics may be invented.

Run fresh cumulative wave1 scoped validation at its actual new import head before WP-2.

## WP-2 — exact reconciliation plus reviewed canonical CI proof

After successful wave1, import the nine DEE1117 paths below from **50171ca7**. The six
original implementation paths came from historical997b5a90 on1a59b31b and were imported
atbd444f35; the three reviewed canonical CI/proof paths were introduced at60d38dfa and
its workflow trigger correction0077bfeb. Their consolidated reviewed bytes at50171 are
the proposed source. Keep all those original histories distinct from successor imports.

Preserve exact valid decimal comparison, valid zero/signed forms, typed invalid refusal
and saved original fee text. Preserve own-property `coolingOffMs` refusal after auth but
before runtime acquisition in the actual registered HTTP handler; preserve server env/
default and trusted internal test clock. Do not change command cooling, attestations,
fees, balances, finality, attribution or authorization policies.

Retain the dedicated fresh canonical-profile CI job and its reviewed broad dependency
triggers, unchanged exact fixture identity and migration procedure, serial two-suite
execution, result guard and actual-artifact upload. No test skip, alternate local identity,
registry repair, protective-trigger weakening or claim of historical native proof as new
execution is allowed. Run fresh cumulative wave2 proof of both children at its new head.

## WP-3 — exact train closure, independent review and checked delivery

Freeze only after the original15 child files are byte-preserved, all incoming33 changed
paths are preserved, the final17-path union is exact, cumulative evidence is recorded,
full current-source root readiness passes, and M01 performs a new bounded current-base
complete-diff/history review. Reuse existing semantic/source reviews as antecedents;
do not pretend they replace the new integration review or label original author work
as independently accepted by that same author.

The current base's16 critical capital registrations and separate3 canonical billing
registrations remain unchanged. The successor contributes the dedicated2 canonical
payment reconciliation suites; these are separate proof sets, not a fictional21-suite
single execution. Require every applicable current-head CI job, including actual fresh
canonical2 proof, before normal merge. Native/heavy work requires root resource grants.

Map every post-admission non-batch commit to exactly one child. Final `actualFiles`
equals those mapped commits' path union. Only the successor plan and manifest may be
outside the children. New issue, branch and plan names replace old1123 metadata; never
import old1123 plan/manifest into the successor. Freeze/admission validator and rendered
PR preflight use the real56ee base, exact head and immutable successor admission.

After checked merge, close only actually delivered children and the successor according
to the new manifest. Original1123 remains explicitly superseded/unmerged, not merged.

## Acceptance Criteria

1. Committed valid admitted inventory on56ee precedes every new implementation/import;
   untouched original branches and raw proof preserve honest chronology. No force/reset,
   old-base substitution, renamed historical admission or Git-provenance disablement.
2. Six wave1 and nine wave2 source paths exactly match50171 after import. Both original
   child semantic contracts and all exclusions remain unchanged; shared numeric parser
   already accepted on main is retained.
3. Real cumulative wave1 then wave2 scoped assertions execute with no failed/skipped
   assertions; exact commands, source heads, outputs and artifact hashes are recorded
   separately from prior167/13 and342/23 receipts. Those old counts are not predictions
   of the new result; incoming proof-guard count changed on main.
4. The existing cross-child independent evidence remains valid for exact source bytes:
   actual adapter/RPC/watcher controls, exact token amount consumed by actual manual
   reconciliation validator/command/HTTP controls, negative malformed/cooling/refusal
   cases and current shared numeric semantics. Nonauthor reviews any actual new delta.
5. All16 incoming capital proof registrations, all3 canonical billing proof registrations
   and the dedicated2 payment proof registrations are preserved with their guards and
   dependencies. Fresh canonical2 CI executes existing companions on all repository
   migrations with unchanged hard identity checks and strict nonempty/no-skips proof.
6. Root full lint/typecheck/build, canon/governance/consumer graphs, exact base diff,
   frozen manifest/preflight, final nonauthor integrated review and all applicable
   current-base/current-head checks pass. Prior native evidence is not relabeled.
7. One accepted integration PR and one code rollback boundary; no production payment,
   cursor/history repair, schema migration, provider/venue/C3/host/live action performed
   as part of validation. Full P08 and empirical/live qualifications remain open.

## Exact pre-admission path ownership

Admitted branch: `dee-1124-payment-integrity-successor`.
Only two successor-owned paths before imports:

```text
docs/plans/dee-1124-payment-integrity-successor.md
docs/plans/dee-1124-payment-integrity-successor.integration-train.json
```

**Wave1 / DEE1116 / serialized / no included dependency:**

```text
docs/plans/dee-1116-payment-observation-integrity.md
lib/waia-core/payment-watcher/run-watcher-cycle.ts
lib/waia-core/payment-watcher/tron-adapter.ts
lib/waia-core/payment-watcher/watcher-cycle.types.ts
tests/unit/payment-watcher-observation-integrity.test.ts
tests/unit/payment-watcher-tron-adapter.test.ts
```

**Wave2 / DEE1117 / serialized / depends on accepted wave1:**

```text
docs/plans/dee-1117-reconciliation-command-integrity.md
lib/trader/settlement/reconciliation/reconciliation-validation.ts
lib/trader/settlement/reconciliation/reconciliation-workflow-handler.ts
tests/helpers/reconciliation-command-memory.ts
tests/unit/reconciliation-exact-manual-amounts.test.ts
tests/unit/reconciliation-workflow-cooling-admission.test.ts
.github/workflows/payment-reconciliation-postgres.yml
scripts/postgres-validation/assert-payment-reconciliation-test-results.mjs
tests/unit/postgres-payment-reconciliation-proof-guard.test.ts
```

The dependency means conservative cumulative integration order across shared payment
evidence, not a new product-semantic or compile-time dependency. Expected child paths
are disjoint and have no overlap with the33 incoming56ee paths. Exactly15 child paths
plus2 new metadata paths means17 total paths. No schema, authority-schema or migration
competition exists. Child plan files are preserved historical source contracts; the new
successor plan controls this delivery boundary without rewriting their prior evidence.

Each path's exact Git blob/SHA256 and old mapped/source commits appear in the descriptive
`successor-preparation-inventory.json`; it is **not** a train manifest or admission.
SHA256 `51b9172b547067489130b5f1dfb98ce63357cd232019ad0d12b01f2304c0a815`.

## Test plan with minimal truthful repetition

Execute the exact wave1 list below on the first new import, not on a detached fixture or
old branch. Fresh output paths must be under the new issue's evidence directory, and
no old logs may be overwritten. Use serial file execution to limit resource contention.

```text
tests/unit/health-payment-watcher-route.test.ts
tests/unit/payment-watcher-checkpoint-repository.test.ts
tests/unit/payment-watcher-confirmation.test.ts
tests/unit/payment-watcher-cycle.test.ts
tests/unit/payment-watcher-normalize-network.test.ts
tests/unit/payment-watcher-observation-integrity.test.ts
tests/unit/payment-watcher-stale-lease-recovery.test.ts
tests/unit/payment-watcher-tron-adapter.test.ts
tests/unit/postgres-capital-proof-guard.test.ts
tests/unit/trader-billing-reality-truth-integrity.test.ts
tests/unit/trader-decimal-billing-boundary.test.ts
tests/unit/trader-risk-numeric.test.ts
tests/unit/treasury-watcher-adapter.test.ts
```

Wave2 reruns those13 plus these10, for the existing23-file cumulative scope:

```text
tests/unit/reconciliation-commands.test.ts
tests/unit/reconciliation-exact-manual-amounts.test.ts
tests/unit/reconciliation-fold-replay.test.ts
tests/unit/reconciliation-priority.test.ts
tests/unit/reconciliation-serialize.test.ts
tests/unit/reconciliation-sweeper.test.ts
tests/unit/reconciliation-transitions.test.ts
tests/unit/reconciliation-workflow-cooling-admission.test.ts
tests/unit/settlement-matching.test.ts
tests/unit/postgres-payment-reconciliation-proof-guard.test.ts
```

Use `pnpm test --run --no-file-parallelism` with normal and JSON reporters and a unique
new output file. Check actual assertions, not only process exit. Scoped lint applies to
the copied production/tests/proof scripts; root serializes full readiness only once the
whole source is frozen. If root accepts the exact wave2 run's current source/provenance,
it need not perform an otherwise identical second local targeted run merely to rename
it root-owned. Full unit suite remains authoritative in PR CI. Any changed source,
failure or unresolved concern requires the affected rerun; retain original failures.

Dedicated payment-native acceptance remains fresh exact-head CI execution of:

```text
tests/integration/postgres-reconciliation-workflow-parity.test.ts
tests/integration/postgres-settlement-reconciliation-parity.test.ts
```

Retain `assert-payment-reconciliation-test-results.mjs`, all current loopback/role/
database guards, auth prelude, every repository migration and artifact upload. Do not
repeat historical local native runs under another name or mutate the incompatible
canonical local registry. Incoming16/3 source registrations and already accepted main
proofs stay attributed to their true heads. All applicable current PR CI still runs;
there is no waiver of required tests. Additional local native runs only when root grants
resources and the current dependency change or an actual failure warrants them.

## Reviewability, gates and rollback

Preserve the prior explicit >800-line rationale:1427 original child-source changed
lines include484 plan and699 test/helper lines, leaving244 production lines. The three
additional reviewed proof files and successor metadata make17paths. Record the final
actual size rather than implying these original-source counts include every new plan
line. Narrow two-child scope, exact immutable source reuse, serialized cumulative proof
and M01's complete-diff review provide the reviewability basis; split if that ceases to
hold. No unrelated Risk/Guardian or new Reality billing authority belongs in this train.

Risk remainsT3 and humanGatePolicy remains `t3-scope-preauthorized` under the user's
existing technical/testing/consolidation delegation. Admission must cite that authority;
it does not ratify rates, fees, HWM, valuation, finality, quorum, cooling duration, source
confidence, empirical science, live activation, security or production changes.

One code-only squash revert restores the prior nontrading release behavior with no
schema/data rollback. It does not undo already observed payment records or authorize
rewriting checkpoints/history. Actual rollback/deployment stays a separate root-controlled
action. Keep both original child branches and1123/680 evidence recoverable.

## Stop conditions

Any failed guard, source drift, undeclared file requirement, child blocker, changed main,
missing independent acceptance or required CI failure stops publication/merge. Report
the specific cause; do not amend governance or enlarge admitted surfaces after imports
to hide it. If newmain appears despite the reservation, reassess exact history before any
merge; this successor does not invent a policy exception for future branch refresh.

Root has reviewed and adopted the exact contract and created DEE-1124. The first
admission commit must now pass root's exact checkpoint review before either import.
No child implementation or fresh cumulative validation is claimed by this admission.
