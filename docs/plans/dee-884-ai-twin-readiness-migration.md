---
integrationIssue: DEE-884
integrationTitle: "AI-TWIN v1 — Legacy readiness migration, backfill and shadow evaluation"
branch: dee-884-ai-twin-readiness-migration
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr, human-production-cutover]
requiredValidation: [lint, typecheck, unit, integration, build, canon, pr-governance]
approvalGates: [plan-approved, shadow-evidence-reviewed, human-merge, human-production-cutover]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-872, DEE-876 and DEE-878.", nextAction: "Begin after target data, Formation and dialogue paths merge." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: "legacy readiness only after Human cutover" }
---

# DEE-884 — Legacy readiness migration, backfill and shadow evaluation

## Approved outcome

Existing users move toward canonical Formation through provenance-honest backfill and shadow evaluation; old percentages are never relabelled as new evidence and rollback remains possible.

## Work packages

### WP-1 — Legacy adapter and backfill
Map only facts actually supported by old data; preserve unknown and mark origin/version.

### WP-2 — Shadow evaluation and demo isolation
Run deterministic dual computation, exclude synthetic demo progress and report representative/boundary differences without false equivalence.

### WP-3 — Cutover and rollback packet
Define measurable thresholds, feature flag, observability, rollback expiry and Human decision ceremony.

## Safety invariants

- No inferred evidence from legacy percent and no demo writer in canonical progress.
- Legacy storage remains until rollback expiry.
- Production semantic cutover is Human-only.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/integration/backfill tests; `pnpm build`; `pnpm validate:canon`; PR governance; Human cutover gate.

