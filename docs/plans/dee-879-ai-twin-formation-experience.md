---
integrationIssue: DEE-879
integrationTitle: "AI-TWIN v1 — Formation, Model Health and Initial Review experience"
branch: dee-879-ai-twin-formation-experience
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, build, e2e, accessibility, canon, pr-governance]
approvalGates: [plan-approved, product-review, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-876.", nextAction: "Begin after authoritative Formation/Model Health API merges." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: "legacy readiness/dashboard target semantics" }
---

# DEE-879 — Formation, Model Health and Initial Review experience

## Approved outcome

The Human sees six canonical domains, evidence maturity, unknowns, contradictions and active caps; explicitly reviews/ratifies the initial model; then enters Model Health/Adviser without certainty theatre.

## Work packages

### WP-1 — Formation information architecture
Render authoritative domain/snapshot explanations, Diary-from-consent and Avatar `20%` eligibility.

### WP-2 — Initial Model Review and transition
Implement evidence/limits/unknown review, explicit ratification and formed-state transition.

### WP-3 — Accessibility and rollback proof
Cover unknown/disputed/stale/unavailable states, responsive/reduced-motion behavior, legacy feature flag and E2E rollback.

## Safety invariants

- Client never recomputes maturity/progress.
- `100%` never claims complete Human knowledge.
- UI grants no identity, social or action permission.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused UI tests; `pnpm build`; `pnpm test:e2e`; accessibility review; `pnpm validate:canon`; PR governance.

