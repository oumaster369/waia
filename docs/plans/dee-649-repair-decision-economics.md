---
integrationIssue: DEE-649
integrationTitle: "AI-TRADER — Repair Decision V2 Execution Payoff + Conservative Economic Range"
branch: dee-649-repair-decision-economics
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, unit, build, pr-governance]
approvalGates: [human-ratified-executable-policy, integration-ready, exact-head-admission]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: null
  completedWorkPackages: [C1, C2, C3]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: 00372f67398245322e11ceb5b69ce6c3f07a04ce
  lastValidationAt: 2026-08-20T10:57:00Z
  blockedReason: null
  nextAction: "Obtain a fresh independent exact-head adversarial review; publication remains withheld."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Human-ratified boundary

The Human Architect ratified `DEE649_MINIMAL_T2_V1` on 2026-08-20 for the current
13-D `EXECUTION_OPPORTUNITY` Forecast family only:

- interim fixed-horizon qualification; unrepresentable ordinary
  ATR/trailing/maxHold/Guardian exits are disabled and this is not a permanent
  first-live position policy;
- sealed qualified Forecast anchor-bar close is the only anchor-price authority;
- explicit partial fills, unfilled entry remainder retained as CASH, no top-up,
  and any post-exit residual makes the evaluated size inadmissible;
- versioned per-side fee, spread, impact, slippage and conservative-stress inputs;
  `Pi_lower <= Pi_base`, with negative outcomes preserved;
- no numeric repository defaults for costs, capacity, slicing or buffers; a sealed
  preregistered policy instance is mandatory;
- an explicit versioned singleton exact-size set for this first evaluator;
- closed exact Forecast-family to Decision-evaluation-contract dispatch;
- no Risk permission, Execution mechanics, independent Guardian policy, runtime
  wiring, live capital, production, official blind holdout, or Execution Server work.

Calibration orchestration is not implemented here. The kernel consumes an already
sealed policy instance and cannot select, tune, or default policy numbers. Existing
canon still requires any capital-authoritative economic evidence stage to consume a
policy frozen under its applicable preregistration gate.

## Integration contract

One Linear integration issue, one branch, one PR, and three serialized work packages.
This is a single-issue integration batch, so the optional multi-issue Integration Train
manifest does not apply.

### C1 — Contract and registry

- Versioned Forecast, anchor, executable-policy, singleton-size and evaluation DTOs.
- Exact closed registry for `EXECUTION_OPPORTUNITY` + `SAMPLE_ENSEMBLE` +
  `exec-opp-13d-v1` + `exec-opp-outcome/v1` + `{30,60}` + interim fixed horizon.
- Content-addressed policy/size authorities and fail-closed validation.
- No venue, fee, capacity, slice or buffer default constructor.

### C2 — Pure execution-payoff functional

- Reconstruct PIT scenario prices only from sealed anchor close and 13-D returns.
- Deterministic scale-8 entry/exit slicing, quantity-step flooring, capacity, minimums,
  partial fills, CASH remainder, per-side component costs and mandatory post-horizon exit.
- Lower payoff is the base payoff minus separately itemized conservative stress; it
  never clips losses.
- Residual inventory, missing authority, invalid arithmetic or contract mismatch fails
  the candidate closed.

### C3 — Evaluation receipts and proof

- Type-7 `Q0.10(lower) / Q0.50(base) / Q0.90(base)` only for the registered family.
- Explicit CASH baseline zero, singleton economically admissible result, structured
  `WhyNotCashReceiptV2`, and causally complete stable digest.
- Unit/property tests for component sensitivity, negative outcomes, partial fills,
  rounding, residuals, missing state, registry mismatch, deterministic replay and
  execution-surface-independent pure semantics.

### Exact-head corrective admission

Independent adversarial review denied the earlier `e8f5105c…` candidate. The
corrective commit `7ce7e072…` therefore adds, without widening runtime scope:

- verified authority receipts bound to exact schema/purpose, organization, account,
  instrument and subject content digest; raw receipts/constructors cannot confer them;
- scientific admission bound to the same organization and exact selected predictive-
  package generation/content plus K/M, preventing stale package qualification reuse;
- one organization/account/venue/SPOT/symbol/base/quote identity digest across
  Forecast, anchor, policy, size and CASH authorities;
- distinct predictive-package generation, Forecast generation and Forecast content
  identities; Forecast K/M, normalization, issuance receipt, anchor epoch/content
  binding and a locally recomputed canonical distribution-semantic digest;
- canonical scale-8 Forecast components as the only payoff input representation;
- exact rational payoff means and rational Type-7 quantiles, with actionability gated
  on exact `EV_lower > 0`; scale-8 receipt fields truncate toward zero and retain exact
  numerator/denominator proofs instead of introducing intermediate HALF_UP semantics;
- deterministic malformed-input rejection and adversarial regressions for stale
  samples, stale anchor, cross-account/instrument substitution, sub-scale ambiguity,
  exact-zero EV and per-component HALF_UP boundaries.

This corrective candidate is not integration-ready until a fresh independent review
attests the exact plan-bearing head and all required validations remain green.

## Compatibility and ownership

- Decision computes economic merit and qualified exact sizes.
- Risk is absent from all payoff/evaluation inputs and may later choose only a member
  of the qualified set or veto it; for a singleton, there is no smaller non-zero member.
- Execution remains the sole owner of order submission and realized fill mechanics.
- Guardian runtime remains unchanged. A protective bypass is outside this kernel and
  requires its separately sealed narrow mandate.
- Legacy `pi*V1` research helpers remain compatibility-only; their loss-destroying
  lower floor is removed, while DEE-634 owns runtime sole-authority wiring to the new
  evaluator.

## Acceptance

- Exact registered Forecast identity is required; unknown family/layout/horizon/policy
  returns a deterministic non-actionable receipt.
- Missing/mismatched anchor, policy, cost, liquidity, capacity, quantity or size
  authority fails closed.
- Every admitted scenario proves `Pi_lower <= Pi_base`; a negative base payoff remains
  negative in the lower transform.
- Entry/exit price and volume components used by the fixed-horizon slice policy affect
  payoff or admissibility; the `R_h` component is explicitly classified as the sealed
  horizon-trigger mark rather than an executable fill price.
- Tests cover partial entry fills, retained CASH, no top-up, quantity-step flooring,
  minimums, per-side costs and post-exit residual rejection.
- Only the exact singleton input can be economically qualified; Decision creates no
  alternate quantity and consumes no Risk or Guardian permission.
- Receipt and evaluation digests are stable for identical inputs and change when any
  causally material Forecast, anchor, policy, size, cost or verdict field changes.
- Historical, paper and live-equivalent callers receive identical pure results for
  identical inputs; no external effect or runtime wiring is introduced.

## Validation

```bash
pnpm vitest run tests/unit/decision-economics-v2.test.ts tests/unit/dee649-execution-payoff-functional-v2.test.ts tests/unit/dee649-decision-economic-evaluator-v2.test.ts
pnpm lint
pnpm typecheck
pnpm build
./scripts/linear/preflight-pr-governance.sh <rendered-pr-body>
```

Before any bounded merge: freeze the exact PR diff, obtain an independent adversarial
review on the exact head, require all mandatory GitHub checks green, and rerun the full
DEE-653/DEE-655 exact-head admission. Linear mutation remains excluded until separately
authorized.
