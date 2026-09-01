---
integrationIssue: DEE-878
integrationTitle: "AI-TWIN v1 — Knowledge Need Planner and adaptive formation dialogue"
branch: dee-878-ai-twin-knowledge-need-dialogue
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, ai-evals, canon, pr-governance]
approvalGates: [plan-approved, dialogue-eval-reviewed, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-874 and DEE-876.", nextAction: "Begin after evidence and Formation contracts merge." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-878 — Knowledge Need Planner and adaptive formation dialogue

## Approved outcome

Dialogue follows Human intent and selects the highest-value safe knowledge need with an explanation, while refusal/skip is non-punitive and abstention is valid.

## Work packages

### WP-1 — Need ranking contract
Define deterministic priority inputs for contradictions, grounding, dynamics, calibration, burden, consent and repetition.

### WP-2 — Dialogue orchestration
Implement typed selection, sensitive-question rationale, skip/withdrawal, replay/idempotency and provider fallback.

### WP-3 — Human-reviewed evals
Cover all domains, tensions, projection traps, repeated refusal, user-led topic changes and no-question states.

## Safety invariants

- No engagement/message-count optimization or synthetic evidence.
- No refusal penalty or compulsive sensitive questioning.
- Question selection and Formation remain independently explainable.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/AI evals; `pnpm validate:canon`; PR governance.
