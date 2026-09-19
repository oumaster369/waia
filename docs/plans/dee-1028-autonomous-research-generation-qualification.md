---
integrationIssue: DEE-1028
integrationTitle: "Autonomous research generation, independent qualification, campaign memory resume (no holdout)"
parentIssue: DEE-601
branch: dee-1028-autonomous-research-generation-qualification
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation:
  [lint, typecheck, targeted-unit, build, validate-canon, validate-pr-governance]
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
  nextAction: "PR to main after independent in-diff P1=0 P2=0 and required CI."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1028 — Autonomous research generation (no holdout)

Packed remaining [DEE-646](https://linear.app/deepsense/issue/DEE-646) research-plane
work after `#611` and `#614` / [DEE-1025](https://linear.app/deepsense/issue/DEE-1025).
One integration issue = one PR.

## Goal

When discovery is **enabled**, the orchestrator can derive a typed
`PARAMETER_MUTATION` or `MULTI_PARENT_COMBINATION` candidate from explicit parent
lineage without caller-supplied generation and without `mean_reversion_v0`.
DEVELOPMENT and walk-forward evaluations must be independent. Research memory can
resume a campaign append-only, retaining prior losses.

Default discovery stays **off**. This batch does not invent historical backtest
PnL and does not unblind holdout.

## Canon check

- Step 21: research may generate/test/propose but cannot become capital authority
  before Human admission.
- `DEFAULT_DISCOVERY_RUN_CONFIG.enabled` stays `false`.
- Derivation must not read closed-trade PnL, winRate, reward, or profitable fields.
- Identical DEVELOPMENT and walk-forward evaluations are not independent
  qualification.
- Append-only research memory may not drop prior contradicting outcomes.
- `holdoutQueryAttempted` remains forbidden. Candidates cannot self-promote or
  assign accounts.
- Do not import connector-dispatch, `placeOrder`, live, or paper cycle runners.

## Work packages

### WP-1 — Derive generation from parent lineage

`deriveStrategyEvolutionGenerationV2` turns one parent into a numeric
`PARAMETER_MUTATION` and two or more distinct parents into a
`MULTI_PARENT_COMBINATION`. Template identity `mean_reversion_v0` is refused.
Missing generation and parents fail closed.

### WP-2 — Independent DEVELOPMENT vs walk-forward

`assertQualificationPartitionsIndependentV2` refuses identical evaluation
content. Walk-forward fitting stays locked (`fittingAllowed: false`).

### WP-3 — Campaign memory resume + discovery wiring

`appendResearchMemoryV2` accepts optional prior memory for the same
org/campaign. Duplicate outcome ids must match; scope mismatch fails closed.
Default-off `runDiscoveryEvolutionPass` derives generation from
`parentStrategies` when `generation` is omitted.

## Acceptance

- Default config still skips with `discovery_run_disabled`.
- Enabled path without generation and without parents fails closed
  `research_v2_generation_incomplete`.
- One parent without caller generation produces `PARAMETER_MUTATION` whose params
  differ by a deterministic numeric mutation, not by outcome PnL.
- Two distinct parents produce `MULTI_PARENT_COMBINATION`.
- `mean_reversion_v0` as candidate or parent identity fails closed.
- Identical DEVELOPMENT and walk-forward evaluations fail closed
  `QUALIFICATION_PARTITIONS_NOT_INDEPENDENT`.
- A second pass with `priorMemory` retains the first pass LOSS and still includes
  negative evidence on the proposal.
- `holdoutQueryAttempted` is still refused.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, targeted research-v2 + discovery
  tests, `pnpm validate:canon`.

## Non-goals

- No C3, holdout unblinding, production `0211`, observation host, live/capital,
  or Execution Server.
- Do not edit `historical-simulation-v2.ts` or `atomic-cycle-repository-postgres-v2.ts`.
- Do not invent DEVELOPMENT / walk-forward economic metrics from closed-trade
  outcome evidence.
- Do not flip `DEFAULT_DISCOVERY_RUN_CONFIG.enabled` to true.
- Do not mark DEE-646 Done.
