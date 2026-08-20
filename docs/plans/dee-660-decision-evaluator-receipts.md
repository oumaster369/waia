---
integrationIssue: DEE-660
integrationTitle: "AI-TRADER — Complete Decision V2 Evaluator + Why-Not-Cash Receipts"
branch: dee-660-decision-evaluator-receipts
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions, linear, github-pr]
requiredValidation: [lint, typecheck, unit, build, canon, pr-governance, authoritative-pr-ci]
approvalGates: [human-ratified-dee649-minimal-t2-v1, independent-exact-head-review, dee-653-exact-head-admission]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: integration-ready
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: b6c8b27117b3bb810fd874a609dca6cab415c401
  lastValidationAt: "2026-08-20"
  blockedReason: null
  nextAction: "Obtain independent exact-head review, then publish one PR and require authoritative CI plus fresh DEE-653 admission."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
humanApproval:
  authorizedAt: "2026-08-20"
  authorizedBaseMain: ba5c2b5558721537ea5f2ce6d9b1faa97b403e19
  authority: "DEE649_MINIMAL_T2_V1 and explicit Program Controller delegation for standalone PR-B"
  condition: "No new semantics or numeric defaults; exact-head DEE-653 admission is required before merge"
---

## Goal

Complete the remaining DEE-649 pure Decision V2 evaluation boundary over the merged
DEE-659 payoff kernel. Verify Forecast and scientific-admission authority, aggregate
replica economics deterministically, evaluate the conservative range, emit the final
Decision verdict/actionability and content-addressed `WhyNotCashReceiptV2`, and prove
replay parity plus legacy `StrategySignal` non-authority.

## Human-ratified boundary

`DEE649_MINIMAL_T2_V1` applies only to the registered 13-D
`EXECUTION_OPPORTUNITY` family and interim fixed-horizon long-only SPOT
qualification. DEE-660 inherits from DEE-659:

- sealed qualified Forecast anchor-bar close;
- explicit partial fills, retained CASH/no top-up, and residual-inventory fail-close;
- versioned per-side cost, capacity, slicing, rounding, and exact singleton-size inputs;
- scenario-wise `Pi_lower <= Pi_base` with negative outcomes preserved;
- no repository numeric defaults;
- no Risk, Execution, Guardian, runtime, persistence, live, production, holdout,
  security-policy, destructive-operation, or Execution Server authority.

Decision actionability is exactly `EV_lower > 0` after every upstream Forecast,
scientific-admission, authority, completeness, and range gate passes. CASH has zero
incremental return in this contract. Risk permission and legacy `StrategySignal`
confidence/expectedEdge/maxRisk are not economic inputs.

## Frozen file map

| File | Ownership |
| --- | --- |
| `docs/plans/dee-660-decision-evaluator-receipts.md` | Canonical scope, evidence, and resumable state. |
| `lib/trader/intelligence/decision-economics/dee660-decision-evaluation-contract-v1.ts` | Versioned evaluator, Forecast/scientific authority, verdict, and reason contracts. |
| `lib/trader/intelligence/decision-economics/dee660-forecast-admission-v1.ts` | Canonical sample reconstruction plus Forecast/scientific/subject verification. |
| `lib/trader/intelligence/decision-economics/dee660-replica-aggregation-v1.ts` | Exact scale-8 rational replica means and Type-7 EV range. |
| `lib/trader/intelligence/decision-economics/dee660-why-not-cash-receipt-v2.ts` | Immutable causal receipt schema and content digest. |
| `lib/trader/intelligence/decision-economics/decision-economic-evaluator-v2.ts` | Fail-closed orchestration over the DEE-659 kernel. |
| `lib/trader/intelligence/decision-economics/index.ts` | Public exports only. |
| `tests/unit/helpers/dee660-decision-evaluator-fixtures.ts` | Reused DEE-659 fixtures plus sealed Forecast/admission authorities. |
| `tests/unit/dee660-decision-contract-admission.test.ts` | Registry, authority, digest, malformed, and negative proofs. |
| `tests/unit/dee660-replica-aggregation.test.ts` | Exact means, Type-7 boundaries, ordering, and determinism. |
| `tests/unit/dee660-decision-economic-evaluator-v2.test.ts` | Verdict, CASH, replay, causal binding, firewall, and parity proofs. |

Files may be split further inside the same bounded directory only to preserve
reviewability; no other surface is admitted.

## Work packages

### WP-1 — Contracts and authority verification

- Add the closed versioned evaluation contract that extends the merged DEE-659
  family contract without changing its payoff semantics.
- Validate canonical K×M samples and recompute the Forecast distribution/content
  digests.
- Require purpose- and subject-bound verified Forecast and scientific-admission
  receipts. Raw digest strings confer no authority.

### WP-2 — Exact aggregation, evaluator, and receipt

- Compute each replica mean from scale-8 scenario payoffs using exact rational math.
- Apply Type-7 Q0.10/Q0.50/Q0.90 exactly and fail closed on invalid range/evidence.
- Evaluate every canonical scenario through the merged DEE-659 kernel.
- Emit `ENTER_LONG` only for an admissible singleton size with exact positive
  `EV_lower`; otherwise emit `CASH` and `DECISION_NON_ACTIONABLE`.
- Bind every causally material Forecast, admission, authority, policy, cost, CASH,
  size, scenario, range, action, and verdict input into `WhyNotCashReceiptV2`.

### WP-3 — Evidence and publication

- Prove negative/boundary/determinism/replay/firewall/authority/causal behavior.
- Run focused gates during development, then exactly one full local suite on the
  frozen exact head.
- Obtain one independent adversarial exact-head review and fix all P1/P2 findings.
- Publish one branch and one PR only after clean scope and review evidence.
- Merge only after authoritative CI and fresh unchanged-head/base DEE-653 admission.

## Acceptance

- Only exact registered Forecast family/layout/horizon/policy resolves.
- Forecast K×M, scale-8 sample semantics, distribution digest, content digest,
  anchor binding, and verified issuance authority all match or fail closed.
- Scientific admission is WF_PREDICTIVE, QUALIFIED, organization/package/K/M bound,
  content-addressed, and separately verified.
- Exact aggregation is deterministic and preserves the mathematical sign at the CASH
  threshold even when a display-scale value truncates to zero.
- `EV_lower <= EV_base <= EV_upper`; invalid/non-finite/incomplete economics are
  NON_ACTIONABLE.
- Every inadmissible scenario fails the singleton size closed.
- Identical historical/paper/live-equivalent pure inputs produce identical results
  and receipts.
- Changing any causal input changes a receipt or fails its verified-authority binding.
- Changing legacy StrategySignal diagnostics cannot change any result or digest.
- No excluded surface appears in the diff.

## Validation

```bash
pnpm vitest run tests/unit/dee660-decision-contract-admission.test.ts tests/unit/dee660-replica-aggregation.test.ts tests/unit/dee660-decision-economic-evaluator-v2.test.ts tests/unit/dee659-execution-payoff-contract-core.test.ts tests/unit/decision-economics-v2.test.ts
pnpm test --run
pnpm lint
pnpm typecheck
pnpm build
pnpm validate:canon
pnpm validate:pr-governance
```

No UI changes exist, so Playwright is not required. The former monolithic evidence
branch/head `15abc5e23b4db66d65b6cffa8ba13eaede82536f` remains read-only and will not
be modified, force-pushed, or published.

## Frozen local evidence

Implementation head `b6c8b27117b3bb810fd874a609dca6cab415c401` passed:

- focused Decision V2 and merged DEE-659 payoff coverage: 5 files, 42 tests;
- `pnpm lint` (0 errors; repository baseline warnings only);
- `pnpm typecheck`;
- `pnpm build`;
- `pnpm validate:canon`;
- `git diff --check`.

Exactly one full local `pnpm test --run` was executed on that frozen implementation
head: 797 files / 4,669 tests passed, 65 files / 297 tests skipped, and 15 files /
47 tests failed outside the DEE-660 diff. The failures reproduced restricted-host or
unrelated baseline conditions: auxiliary Git worktree creation was denied by the
external shared Git directory, localhost socket binding was denied, and legacy FHV
timing/database-fixture tests failed. Every DEE-660 test and every directly affected
payoff/economics test passed. The full local suite will not be looped; authoritative
GitHub PR CI is the required clean full-suite gate.
