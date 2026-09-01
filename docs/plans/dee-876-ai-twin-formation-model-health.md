---
integrationIssue: DEE-876
integrationTitle: "AI-TWIN v1 — Deterministic Formation Contract and Model Health engine"
branch: dee-876-ai-twin-formation-model-health
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, integration, canon, pr-governance]
approvalGates: [plan-approved, semantic-eval-reviewed, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-871 and DEE-874.", nextAction: "Begin after ledger and extraction contracts merge; ship shadow-only." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: "legacy readiness computation after DEE-884 Human cutover" }
---

# DEE-876 — Deterministic Formation Contract and Model Health

## Approved outcome

Application logic derives six-domain maturity, evidence coverage and caps `19/49/74/99`; `100%` requires a Human Initial Model Review. Model Health is separate and may change afterward.

## Work packages

### WP-1 — Versioned requirement ledger
Freeze domain evidence requirements, explanations, cap precedence and configuration/version semantics.

### WP-2 — Formation and ratification
Implement deterministic snapshots, initial-model review receipt and shadow output beside legacy readiness.

### WP-3 — Model Health and proof
Implement freshness/corroboration/calibration/contradiction/gap health and exhaustive boundary fixtures.

## Safety invariants

- No LLM-set percent and no 100% without Human ratification.
- Health changes never erase historical formation.
- No trust, disclosure, social or action grant derives from Formation.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; exhaustive unit/property/integration tests; `pnpm validate:canon`; PR governance.

