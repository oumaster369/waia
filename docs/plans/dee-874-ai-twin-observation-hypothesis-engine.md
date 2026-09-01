---
integrationIssue: DEE-874
integrationTitle: "AI-TWIN v1 — Observation extraction and competing-hypothesis engine"
branch: dee-874-ai-twin-observation-hypothesis-engine
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, ai-evals, security, canon, pr-governance]
approvalGates: [plan-approved, eval-reviewed, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-871.", nextAction: "Begin only after the epistemic ledger contract merges." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-874 — Observation extraction and competing-hypothesis engine

## Approved outcome

The model proposes strict, provenance-linked observations, claims, relations, contradictions and plural hypotheses; deterministic application code decides what enters authoritative state.

## Work packages

### WP-1 — Strict proposal schemas
Define projection-aware extraction and hypothesis/falsifier structures for dialogue and Diary.

### WP-2 — Provider pipeline and acceptance gate
Implement minimal-context inference, injection-resistant source handling, validation and safe abstention.

### WP-3 — Epistemic/privacy evals
Prove unsupported inference, projection error, contradictions, alternatives, refusal and outage behavior.

## Safety invariants

- The model cannot write percentages or authoritative Human claims.
- No clinical/biometric personality or emotion diagnosis.
- Private provider context is minimized and redacted.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/AI/security evals; `pnpm validate:canon`; PR governance.

