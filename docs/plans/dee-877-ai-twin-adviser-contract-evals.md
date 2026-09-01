---
integrationIssue: DEE-877
integrationTitle: "AI-TWIN v1 — Adviser reasoning contract and safety evaluations"
branch: dee-877-ai-twin-adviser-contract-evals
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, ai-evals, security, canon, pr-governance]
approvalGates: [plan-approved, high-impact-policy-reviewed, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-875 and DEE-876.", nextAction: "Begin after calibration and Formation/Model Health merge." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-877 — Adviser reasoning contract and safety evaluations

## Approved outcome

At formed state, advice follows the canonical eight-part structure or abstains, is evidence/assumption traceable, preserves option diversity and leaves every decision with the Human.

## Work packages

### WP-1 — Advice schema and retrieval
Define intent, evidence, assumptions/projection, options, consequences, unknowns, reversible experiment and decision-boundary object.

### WP-2 — High-impact policy and provider adapter
Implement grounding, specialized high-impact restrictions, qualified-professional handoff and outage behavior.

### WP-3 — Human-centered evals
Evaluate manipulation, sycophancy, false certainty, option collapse, free-will violations and abstention.

## Safety invariants

- Advice never executes or grants authority.
- No superior/omniscient mentor posture or unqualified high-stakes directive.
- Uncertainty and doing-nothing remain valid outputs.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/AI/security evals; `pnpm validate:canon`; PR governance.

