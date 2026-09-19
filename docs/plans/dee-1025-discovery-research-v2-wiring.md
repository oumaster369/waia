---
integrationIssue: DEE-1025
integrationTitle: "Wire default-off discovery orchestrator to Strategy Evolution research-v2 spine"
parentIssue: DEE-601
branch: dee-1025-discovery-research-v2-wiring
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
  currentWorkPackage: WP-5
  completedWorkPackages: [WP-5]
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

# DEE-1025 — Discovery orchestrator research-v2 wiring

Split from [DEE-646](https://linear.app/deepsense/issue/DEE-646) after `#611`. One
integration issue = one PR; this batch owns only default-off
`runDiscoveryEvolutionPass` consumption of the research-v2 spine.

## Goal

When discovery is **enabled**, `runDiscoveryEvolutionPass` consumes
`runStrategyEvolutionResearchPassV2`. When **disabled** (default), it still
returns `skipped: discovery_run_disabled` and writes nothing capital-authoritative.

## Canon check

- Step 21: research may generate/test/propose but cannot become capital authority
  before Human admission.
- `DEFAULT_DISCOVERY_RUN_CONFIG.enabled` stays `false`. Do not turn discovery on.
- Enabled path does not synthesize `mean_reversion_v0` or rank an empty evidence Map.
- Closed-trade mapping retains PROFIT/LOSS/FLAT/INCONCLUSIVE/INVALIDATED. Losses
  are never omitted from the evidence package.
- Missing Navigator, raw MKB, legacy mutation, holdout-as-fitness, and
  `NOT_ADMITTED` fail closed. `RESEARCH_ONLY` is valid on this plane and still
  has `capitalAuthority: RESEARCH_ONLY` / no venue write.
- Direct `pnl` / `winRate` / `reward` / `profitable` fields cannot be discovery
  fitness. Reuse `assertNoBannedFields` on config.
- Do not call `promoteStrategyCandidateV2` or `assignStrategyCandidateToAccountV2`.
- Discovery and research-v2 must not import connector-dispatch or `placeOrder`.

## Work packages

### WP-5 — Discovery orchestrator wiring

`runDiscoveryEvolutionPass` keeps the default-off skip. When enabled and the
campaign is ACTIVE, required research-v2 admission fields must be present or the
pass fails closed. Closed trades map to `ClosedTradeOutcomeInputV2` (losses
retained). The orchestrator calls `runStrategyEvolutionResearchPassV2` and maps
ids/digests into `DiscoveryEvolutionPassResult` without self-promotion, account
assignment, or venue write.

## Acceptance

- Default config still skips with `discovery_run_disabled` and does not call
  research-v2.
- Enabled path without Navigator/admission fields fails closed and does not
  synthesize `mean_reversion_v0`.
- Enabled RESEARCH_ONLY + Navigator + outcomes including a LOSS reaches
  `HUMAN_PROPOSAL_PENDING` (or the expected v2 status); the losing outcome is
  retained; `capitalAuthority` remains `RESEARCH_ONLY`.
- `holdoutQueryAttempted` is refused.
- Banned fitness fields on config are still refused.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, targeted discovery + research-v2
  tests, `pnpm validate:canon`.

## Non-goals

- No C3, holdout unblinding, production `0211`, observation host, live/capital,
  or Execution Server.
- No `run-live-cycle` / `paper-cycle-runner` / connector-dispatch rewrite.
- Do not edit `lib/trader/paper/**` or `lib/trader/live/**`.
- Do not flip `DEFAULT_DISCOVERY_RUN_CONFIG.enabled` to true.
