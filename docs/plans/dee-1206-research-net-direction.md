---
integrationIssue: DEE-1206
integrationTitle: "AI-TRADER: preserve signed after-cost short returns in research admission"
batchMode: single-issue
branch: dee-1206-research-net-direction
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, lint, typecheck, build, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: [WP-4]
  nextAction: "After the prepared DEE1212 dependency chain merges, rebase onto exact main; complete admission and require published-head CI."
provenance:
  createdFrom: "Independent October 1 code audit and explicit user authorization for technical fixes"
  supersedes: null
---

# DEE-1206 — research net convention correction

Plan frozen before source changes. Original implementation base: main `31c78cba`.
Prepared integration base: DEE1212 prepared head `818d63246fa89841d6151c4772ce468310ea1592`; this is not merged authority. Actual main remains `98a591c8`. Parent: DEE-1152.
The user authorizes technical corrections, tests, independent audits and PR
integration after required checks. This implements existing after-cost return
meaning; it changes no financial threshold, cost constant, strategy or live gate.

## Concrete defect

`QualificationEvaluationV2.dateNets` is documented as after-cost strategy nets.
The current calculator negates the entire net for a declared short, reversing
fees and already signed profits/losses. A source-bound pure counterexample with
two `-0.007` observations reports `+0.007` for short and `-0.007` for long. Both
remain insufficient data; no production false qualification is demonstrated.
The current orchestrator accepts supplied windows; an authoritative producer is
still separate DEE-1152/1159 work.

## Frozen compatibility and funding decision

- Add the exact convention `signed-net-after-all-costs/v2`. Under it, each net
  already includes direction, trading costs and funding; neither direction nor
  a second funding subtraction may change the value. Existing funding metadata
  validation remains mandatory for perpetual inputs. A convention label is a
  declared arithmetic contract, not provenance or funding attestation.
- Keep the existing unversioned **long** standalone calculation and historical
  long receipt replay byte-compatible, including its separately deducted funding
  behavior. Do not alter its tests or reinterpret persisted historical bytes.
  Unversioned non-long calculations refuse rather than guess their sign convention.
- New qualification records always bind the corrected convention internally.
  Callers cannot request the legacy writer/replay path. The consumer validates
  the exact recorded convention and recomputes using it. Only an unmarked legacy
  long record can use the private compatibility replay path; unmarked short
  records remain historical data but refuse current qualification reuse.
  Both partitions of a qualification pair must use the same convention; mixed
  legacy/V2 pairs refuse even when each record is individually replayable.
- Explicit V2 two-sided input is also already direction-resolved and inclusive
  of funding. Preserve its net and existing two-sided statistical test; no
  funding direction is inferred. Unversioned non-long input refuses instead of
  treating a pre-direction return as costed strategy PnL. Do not invent a funding,
  borrow or cost model. Actual funded-side series provenance and spot borrowing
  proof remain separate source/executable qualification gaps.

## Acceptance

Preserve signed all-cost returns, replay old long records under their original
arithmetic, refuse unsupported or mixed conventions, and retain statistical
thresholds and source-authority boundaries. The work packages below provide
the required calculator, record, journal and caller evidence.

## Work packages

1. Root owns the calculator and qualification builder/consumer change. Preserve
   IS/Holm/sample/stability/validation rules and the existing long compatibility
   path. Explicitly reject unknown conventions and invalid directions.
2. A separate test owner adds narrow RED/GREEN calculator and actual record
   roundtrip tests: short fee loss, short gain, long equality; already included
   positive/negative funding charged once; missing funding refusal and explicit
   V2 two-sided preservation;
   corrected records replay; legacy long replay; old short and forged convention
   refusal; no caller route to historical compatibility mode.
   New validation and DEVELOPMENT journal payloads carry the same convention;
   historical rows remain unchanged. Existing JSON persistence retains the field
   without a schema migration. The marker does not establish source provenance.
3. Root refreshes only mechanically affected inventories/command closures using
   the checked-in generator. Preserve allowlists and historical exceptions.
4. Scoped units, lint/typecheck/build/canon/consumer graphs, independent review,
   then final published-head CI. No duplicate full local suite. Publication is
   serialized after current PR732 and priority dependency repairs.

## Boundaries and rollback

No migrations, source payload reads, C3/holdout access, production deployment,
strategy promotion or live activation. Do not rewrite old records or claim that
caller-supplied metrics are qualified. All new records are research-only. A revert
PR is the code rollback; old or unsupported receipts fail qualification reuse.


## Prepared dependency integration evidence (2026-10-02)

For queue preparation only, the two DEE1206-owned commits were rebased onto
prepared DEE1212 head `818d63246fa89841d6151c4772ce468310ea1592`. This is not a
merged dependency or an actual-main rebase: actual main remains `98a591c8`,
and DEE1212 itself still waits for its DEE1211 dependency and exact-head CI.
The five implementation/test/fixture blobs match the pre-rebase commit exactly;
this plan’s metadata alone was updated to name the prepared parent. The previous
actual-main native/synthetic records remain bound to their recorded source; this
rebase ran no database/native suite.

On the prepared combined tree, the six-file research regression set passed
98/98 with zero failures/skips, full lint passed (0 errors;331 warnings),
typecheck/build/canonical validation (288 docs) passed, and both whole-repository
graph validators passed (Reality V2 164 sources/154 consumers/27 connector
references; Execution V2 zero violations). The two graph unit files added27
passing tests. Logs and exact hashes are in external
`dee1206-after1212-readiness`. Exact-main rebase, independent review and
published-head CI remain. This work does not qualify a strategy or alter
financial thresholds, cost inputs, production state, or trading authority.
