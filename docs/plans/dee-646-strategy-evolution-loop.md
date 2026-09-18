---
integrationIssue: DEE-646
integrationTitle: "Complete autonomous Strategy Evolution research → test → Human proposal loop"
parentIssue: DEE-601
branch: dee-646-strategy-evolution-loop
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
  onMerge: In Progress
state:
  status: in-progress
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3, WP-4]
  remainingWorkPackages: [WP-5]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Library spine PR to main with Linear keep-open. Remaining WP-5 is wiring runDiscoveryEvolutionPass, not this merge."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-646 — Strategy evolution research → test → Human proposal (library spine)

## Goal

Prove one fail-closed research plane that cannot become capital authority:

`Closed-trade/outcome evidence → immutable research memory (profit and loss retained) →
research question → falsifiable hypothesis → candidate generation (parameter mutation or
multi-parent combination with explicit lineage) → DEVELOPMENT + walk-forward qualification
records → Human promotion proposal (pending only)`.

Capital authority is `NONE` / `RESEARCH_ONLY`. Candidates cannot self-promote, assign accounts,
write venues, or consume blind holdout as iterative fitness.

This batch adds the `lib/trader/research-v2` library spine. It does not rewrite
`runDiscoveryEvolutionPass`.

## Canon check

- Existing discovery orchestrator stays default-off. The new module is the canonical research
  spine, not a second capital lane.
- Direct `pnl` / `winRate` / `reward` / `profitable` fields cannot be discovery fitness. Reuse
  `no-reinforcement-guard`. Economic outcomes are evaluation evidence, not generator ranking.
- Negative outcomes persist. Survivorship discard of the evidence package is forbidden.
- DEE-771/772/773 are consumed, not reimplemented. RESEARCH_ONLY, missing Navigator, raw MKB, and
  unqualified future-cycle feedback fail closed.
- Production write-enabled ingress remains `lib/trader/execution/v2/connector-dispatch.ts`.

## Work packages

### WP-1 — Outcome evidence + append-only research memory

Closed-trade outcomes keep PROFIT, LOSS, FLAT, INCONCLUSIVE, and INVALIDATED records. Building an
evidence package cannot omit polarities. Research memory is append-only and queryable for
contradicting outcomes.

### WP-2 — Question, hypothesis, candidate generation

Research question cites supporting and contradicting memory counts. Hypothesis is falsifiable.
Candidates are typed `PARAMETER_MUTATION` (one parent) or `MULTI_PARENT_COMBINATION` (two or more
parents) with explicit lineage, research-code identity, and cost-model identity. Capital authority
is `RESEARCH_ONLY`. Account assignment is refused.

### WP-3 — DEVELOPMENT + walk-forward qualification

Qualification records exist for DEVELOPMENT (fitting allowed) and walk-forward (fitting locked).
Blind holdout as iterative fitness is an explicit refuse. A failed candidate is recorded
`REJECTED` and cannot be rewritten as promoted.

### WP-4 — Human proposal + knowledge gate + consumer inventory

Pending Human-only promotion proposals include positive and negative evidence. Knowledge admission
consumes Navigator V2 and future-cycle epistemic effect. Research-v2 modules must not import
connector-dispatch or `placeOrder`.

### WP-5 — Discovery orchestrator wiring (deferred)

Do not rewrite `runDiscoveryEvolutionPass` in this batch. A later WP may consume the research-v2
spine from that default-off orchestrator. Keep Linear in progress until that wiring is proven.

## Non-goals

- No production `0211`, H2/post-H2, C3, observation host, HTX keys, live-enable, capital, or
  Execution Server.
- No `run-live-cycle` / `paper-cycle-runner` / connector-dispatch rewrite.
- No holdout unblinding and no self-promote/account-assignment path.
