---
integrationIssue: DEE-881
integrationTitle: "AI-TWIN v1 — Personal Adviser and co-research workspace"
branch: dee-881-ai-twin-adviser-workspace
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, build, e2e, accessibility, canon, pr-governance]
approvalGates: [plan-approved, product-review, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-877 and DEE-879.", nextAction: "Begin after Adviser API and formed-state experience merge." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-881 — Personal Adviser and co-research workspace

## Approved outcome

A calm, inspectable workspace presents the full advice structure, Model Health, corrections, reversible experiments and outcome follow-up while keeping every decision with the Human.

## Work packages

### WP-1 — Advice and evidence surface
Render intent, evidence, assumptions, options, consequences, unknowns and Human-decision boundary.

### WP-2 — Co-research controls
Add contested-claim correction, decline/defer, experiment and later outcome flows.

### WP-3 — Failure/accessibility proof
Cover high-impact restriction, abstain/unavailable, responsive and accessible E2E states.

## Safety invariants

- No connector or action execution.
- Uncertainty cannot be hidden in chat prose.
- Copy never implies that WAIA decided for the Human.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused UI tests; `pnpm build`; `pnpm test:e2e`; accessibility review; `pnpm validate:canon`; PR governance.

