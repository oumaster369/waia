---
integrationIssue: DEE-1118
integrationTitle: "Enforce unresolved contradiction veto in required sufficiency"
parentIssue: DEE-596
branch: dee-1118-sufficiency-contradiction-veto
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
approvalGates: [plan-approved, integration-ready, human-merge]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: integration-readiness
  completedWorkPackages: [WP-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Controller obtains independent exact-head review and completes serial readiness before publication."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1118 — Required contradiction veto

## Existing contract and demonstrated defect

The ratified [DEE-685 plan](dee-685-required-information-sufficiency-gate.md),
semantic boundary and acceptance criterion 2, already forbids compensation of an
unresolved required contradiction by other evidence or an aggregate score.
`SUFFICIENT` remains only an epistemic prerequisite; it grants no capital or
execution authority. This correction introduces no new contradiction policy.

On accepted base `ed2a25f72008a97211c9454fd29d4f62a65508b2`, a mandatory
`FAIL_UNRESOLVED` requirement with a valid supporting observation and a matched
`UNRESOLVED` observation for the same claim was marked
`ANSWERED_SUFFICIENTLY` / `SUFFICIENT`. The rejected observation's
`EVIDENCE_CONTRADICTION_UNRESOLVED` reason remained in the receipt, but did not veto
the successful candidate. Runtime admission accepted that receipt, and inquiry
could silently stop with `NO_ADDITIONAL_EVIDENCE_NEEDED`.

This is a deterministic synthetic reproduction of the actual evaluator and
consumers. It is not a claim that a production run, historical singleton `NONE`
producer, scientific result or real order was affected.

## WP-1 — Reuse the existing matched-candidate rejection as a veto

In `evaluateRequirement`, any matched candidate carrying the existing
`EVIDENCE_CONTRADICTION_UNRESOLVED` reason prevents `passed`. Existing terminal
selection then returns `UNRESOLVED_CONTRADICTION`, and the existing requirement
classification determines whether the overall receipt is blocked. No new reason,
terminal, schema, profile identity, threshold or caller API is introduced.

Behavior to preserve:

- Mandatory and active context-triggered requirements block in all three declared
  purposes. Purpose and account/org/symbol/venue/timeframe/horizon applicability
  remain exact. A separately sufficient open-position reassessment profile remains
  separate from new-opportunity denial.
- Optional requirements remain nonblocking for overall sufficiency. Inactive
  context remains `NOT_REQUIRED`; inapplicable profiles remain `NOT_APPLICABLE`.
- `RECORD_ONLY` keeps recording unresolved observations without this veto.
  `REQUIRE_AGREEMENT` retains its stricter refusal of both conflicting and
  unresolved observations. `FAIL_UNRESOLVED` does not acquire a new refusal for
  `CONTRADICTS` alone.
- Evidence outside the declared satisfier family/provider does not participate.
  Existing freshness, trust, PIT, replay, independence, canonical ordering and
  duplicate-observation checks remain intact. Extra support and an aggregate PASS
  cannot compensate the required contradiction.

## Replay and inquiry compatibility

`tests/fixtures/sufficiency/dee1118-before-fix.json` contains two receipts produced
by the actual evaluator before the correction, with the exact base SHA. The old
false-positive receipt now fails the existing deterministic replay validator and
authority binding; an already assembled runtime authority is blocked as
`INVALID_AUTHORITY`. The unaffected supported-only receipt replays identically.
No persisted receipt is rewritten, resealed or represented as newly verified.
Repository consumers already use this same replay validator; this work does not
claim a native database read/migration proof.

Inquiry's existing materiality contract requires an actual `CONTRADICTS`
observation and exact shared-claim observation lineage. A two-item
SUPPORTS+UNRESOLVED fixture cannot invent that lineage: the corrected receipt
blocks sufficiency, and inquiry refuses `missingContradictionLineage` before
acquisition. A separate three-item SUPPORTS+UNRESOLVED+CONTRADICTS fixture supplies
valid exact lineage, obtains a READY plan, calls an inert unavailable source once,
and remains insufficient. Supported-only input still makes zero acquisition
calls. No inquiry validator or acquisition policy changes.

The planner independently requires lineage for every
`UNRESOLVED_CONTRADICTION` terminal, including optional requirements. Thus an
optional receipt remains overall `SUFFICIENT` while inquiry without that lineage
can refuse. The tests preserve and explicitly expose this composition limit;
optionality is not presented as a waiver of the planner's separate contract.

## Validation and limits

The focused suite runs 31 cases through actual evaluator, replay, authority
admission, planner and inquiry runtime functions with synthetic evidence and
inert acquisition. Corrected baseline fixtures reproduce 10 failures / 21 passes;
the implementation passes all 31. An earlier attempt to construct two-item
materiality lineage failed its fixture contract; that setup error is separate
from the final baseline defect evidence.

Run the focused regression:

```sh
pnpm test --run tests/unit/trader-sufficiency-contradiction-veto.test.ts
```

The nine-suite companion run includes existing sufficiency contracts/runtime/
consumer closure, inquiry contracts/planner/loop/consumer closure, and the inert
`tests/integration/trader-information-inquiry-runtime.test.ts`: 114 cases pass.
Scoped ESLint and `git diff --check` are required before author freeze. Controller
owns full lint/typecheck/build, canon/governance/consumer graph/preflight,
independent exact-head review and final PR CI. These are not claimed by the
author's focused acceptance.

No SQL/schema migration, empirical policy, profile/threshold change, existing
receipt rewrite, Guardian action lane, Risk/Execution permission, provider call,
live activation, production operation, C3 worker change or holdout read is included.
Hashes in synthetic fixtures demonstrate content identity, not source authority.


### Accepted-base refresh 2565e1a2

Normal merge `ccf982d6e33cd84772745488e9afb9f1cc5c0ea7` incorporates accepted main `2565e1a23741d0042096fd8209cd9793e8aa7e19` without conflicts. All five author paths and six incoming paths are disjoint and their blobs preserved exactly; only this plan supplement changes afterward. All13 incoming mandatory native registrations and source blobs are retained. No native or persisted scientific evidence is newly qualified. Root schedules scoped offline acceptance, full repository readiness and independent delta review before publication, followed by all applicable exact-head CI checks. The required-information veto does not change acquisition policy, actual lineage validation, optional evidence or the separate open-position lane.

### Accepted-base refresh 21a60ec3

Normal merge `0912dcd5bea81d7c5c3325d821f47bfff63c161e` incorporates exact accepted main `21a60ec38573f0ca5c535992e9e09392c2aa78c9` from prior clean `70a6b5a4` without conflicts. All five author paths and nineteen incoming paths are disjoint; immutable blobs and complete binary patches in both directions are identical at merge. This supplement is the only subsequent change. All fifteen incoming native suite registrations and bodies, serial execution and no-skips guard remain unchanged.

Scoped offline acceptance at the merge: 130 tests in ten files, all passed without skips (the prior114 sufficiency/inquiry cases plus16 executed-proof guard controls). Scoped ESLint and diff checks passed. Evidence is `evidence/dee-1118/accepted-base-21a60ec3/`. No native/DB run or full readiness was performed for this refresh; prior2565 root readiness remains historical evidence, not a current-base result. Root owns full readiness, independent delta review and exact-head CI/publication. No new source, policy, persisted evidence or capital authority is introduced.
