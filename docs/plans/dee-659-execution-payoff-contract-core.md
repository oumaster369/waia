---
integrationIssue: DEE-659
integrationTitle: "AI-TRADER — Seal Execution Payoff Contract Core + Deterministic Scenario Kernel"
branch: dee-659-execution-payoff-contract-core
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions, linear, github-pr]
requiredValidation: [lint, typecheck, unit, build, canon, pr-governance, authoritative-pr-ci]
approvalGates: [human-ratified-executable-policy, independent-exact-head-review, dee-653-exact-head-admission]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: null
  completedWorkPackages: [PR-A]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: fa3fc5cd66fe32bb947b2e694ceb37aae554d204
  lastValidationAt: "2026-08-20"
  blockedReason: null
  nextAction: "Publish one PR; require exact-head CI and fresh DEE-653 admission before bounded squash merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
humanApproval:
  authorizedAt: "2026-08-20"
  authorizedBaseMain: 5da547f82c51a4f2448f8533b8834fa51cc864e6
  authority: "Human directive authorizing DEE-659 publication and bounded autonomous squash merge serialized after DEE-656"
  condition: "Exact-head DEE-653 admission remains fail-closed and required immediately before merge"
---

## Human-ratified boundary

The Human Architect ratified `DEE649_MINIMAL_T2_V1` on 2026-08-20 for the current
13-D `EXECUTION_OPPORTUNITY` Forecast family only. DEE-659 extracts the first atomic,
reviewable prerequisite from the protected DEE-649 evidence branch:

- interim fixed-horizon long-only SPOT qualification;
- sealed qualified Forecast anchor-bar close as the only price anchor;
- explicit partial fills, unfilled entry remainder retained as CASH, and no top-up;
- mandatory post-horizon exit slices with any residual inventory inadmissible;
- versioned per-side fee, spread, impact, slippage and conservative-stress inputs;
- scenario-wise `Pi_lower <= Pi_base`, with negative outcomes preserved;
- no numeric repository defaults for costs, capacity, slicing, buffers, or sizing;
- one exact Human-authorized base-asset quantity and explicit CASH snapshot;
- closed exact Forecast-family/evaluation-contract dispatch;
- no Risk, Execution, Guardian, runtime, database, live, production, blind-holdout,
  raw-storage/security, destructive-operation, or Execution Server authority.

The protected evidence branch `dee-649-repair-decision-economics` at
`15abc5e23b4db66d65b6cffa8ba13eaede82536f` is read-only evidence. This plan starts
from authoritative `origin/main@efe570fda2eb1d6bc3fc4ce06837e50944b53c23`.
Publication continuation on 2026-08-20 mechanically rebased the three patch-equivalent
DEE-659 commits onto `origin/main@5da547f82c51a4f2448f8533b8834fa51cc864e6`
after merged PR #471; the original baseline remains implementation provenance.

## PR-A contract

### Contract and explicit authorities

- Version the economic contract, fixed-horizon policy, rounding/slicing doctrines,
  current Forecast identity, and closed registry.
- Bind anchor, policy, singleton size and CASH authorities to one exact
  organization/account/venue/SPOT/instrument identity and stable content digests.
- Require separate verified, purpose-specific, subject-bound receipts. Raw receipt
  digests and constructors do not confer verified authority.

### Pure scenario-payoff kernel

- Reconstruct scale-8 scenario prices from sealed anchor close and 13-D log returns.
- Apply deterministic weighted entry/exit slices, quantity-step flooring, sealed
  participation capacity, minimums, partial fills, CASH limits and no top-up.
- Itemize per-side fee/spread/impact/slippage and conservative stress using exact
  scaled-integer arithmetic with HALF_UP component rounding.
- Preserve physical downside. Lower payoff subtracts conservative stress without a
  zero floor.
- Classify `R_h` only as the mandatory-exit trigger mark, never an executable fill.
- Fail closed on missing/mismatched authority, invalid sample/contract, no entry fill,
  or post-exit residual inventory.

## Acceptance

- Exact registered identities resolve and contract mismatches fail closed.
- Authority content, subject, organization, account and instrument mismatches fail.
- Every admissible scenario satisfies `Pi_lower <= Pi_base`; losing outcomes remain
  negative in the legacy helper and V2 kernel.
- Tests cover costs, scale-8 boundaries, partial fills, retained CASH, cash limits,
  quantity flooring, minimums, capacity, component materiality, residual inventory,
  malformed samples, missing authority and identical-input determinism.
- The exact branch head passes focused tests, full unit suite, lint, typecheck, build,
  and fresh independent adversarial review with no unresolved P1/P2 finding.

## Explicit PR-B boundary

DEE-649 PR-B alone owns Forecast and scientific-admission verification, exact replica
means/Type-7 EV aggregation, economic range, `decisionActionable`, verdict/action,
`WhyNotCashReceiptV2`, legacy StrategySignal non-authority proof, replay parity, and
all Decision/Risk/Execution/Guardian/runtime/persistence integration. DEE-659 creates
no capital permission and no external effect.

## Validation

```bash
pnpm vitest run tests/unit/dee659-execution-payoff-contract-core.test.ts tests/unit/decision-economics-v2.test.ts
pnpm test --run
pnpm lint
pnpm typecheck
pnpm build
```
