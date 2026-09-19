---
integrationIssue: DEE-1029
integrationTitle: "Human research assignment, research-job isolation, retirement proposal (no holdout)"
parentIssue: DEE-601
branch: dee-1029-human-assignment-research-job-isolation
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

# DEE-1029 — Human assignment, research-job isolation, retirement

Packed remaining [DEE-646](https://linear.app/deepsense/issue/DEE-646) research-plane
work after `#617` / [DEE-1028](https://linear.app/deepsense/issue/DEE-1028).
One integration issue = one PR.

## Goal

Add fail-closed research-plane objects so a Human can assign a pending candidate
to RESEARCH or PAPER accounts, background research yields to capital runtime,
and a REJECTED candidate produces a Human-only retirement proposal.

Capital authority stays `NONE`. Live assignment is refused. Default discovery
stays **off**. This batch does not invent historical backtest PnL and does not
unblind holdout.

## Canon check

- Step 21: research may generate/test/propose but cannot become capital authority
  before Human admission.
- Candidates cannot self-assign. Human assignment is org-scoped and never LIVE.
- Research jobs cannot claim open-position / Risk / Guardian / Execution /
  reconciliation class, mutate assignment, mutate Risk policy, or starve capital
  runtime.
- Retirement is a pending Human proposal with no live demotion authority.
- `holdoutQueryAttempted` remains forbidden.
- Do not import connector-dispatch, `placeOrder`, live, or paper cycle runners.

## Work packages

### WP-1 — Human research assignment

`admitHumanResearchCandidateAssignmentV2` binds a pending Human proposal to one
or more same-org accounts. One strategy may map to many accounts; one account
may receive many strategies. Cross-org accounts and `LIVE` fail closed.
`assignStrategyCandidateToAccountV2` still throws.

### WP-2 — Research-job isolation

`ResearchJobV2` is a finite-budget background envelope. It yields
`CAPITAL_RUNTIME_ACTIVE` instead of completing. Enabled discovery with
`capitalRuntimeActive` returns `research_yielded_to_capital_runtime` and does
not call the research pass.

### WP-3 — Retirement proposal on REJECTED

A REJECTED research pass emits `buildResearchRetirementProposalV2` with
`approvalAuthority: HUMAN_ONLY`, `capitalAuthority: NONE`, and
`liveDemotionAuthority: NONE`.

## Acceptance

- Default config still skips with `discovery_run_disabled`.
- Human assignment of one candidate to two accounts in one org succeeds; the
  same account can receive a second strategy; a foreign org account is refused.
- Candidate self-assign still throws `CANDIDATE_ACCOUNT_ASSIGNMENT_FORBIDDEN`.
- LIVE lifecycle on Human assignment is refused.
- Enabled discovery with `capitalRuntimeActive: true` yields and does not call
  research-v2.
- A research job cannot claim Guardian/Risk/Execution runtime class.
- REJECTED pass emits a Human-only retirement proposal with
  `capitalAuthority: NONE`.
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
