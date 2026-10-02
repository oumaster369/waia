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
  status: in-review
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: [WP-4]
  nextAction: "Rebase onto actual main, review final source binding and require all published-head CI."
provenance:
  createdFrom: "Independent October 1 code audit and explicit user authorization for technical fixes"
  supersedes: null
---

# DEE-1206 — research net convention correction

Plan frozen before source changes. Base: main `31c78cba`. Parent: DEE-1152.
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
