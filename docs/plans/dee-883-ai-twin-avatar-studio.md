---
integrationIssue: DEE-883
integrationTitle: "AI-TWIN v1 — Avatar Studio capture and representation experience"
branch: dee-883-ai-twin-avatar-studio
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, build, e2e, accessibility, security, canon, pr-governance]
approvalGates: [plan-approved, privacy-copy-reviewed, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-879 and DEE-882.", nextAction: "Begin after authoritative Formation eligibility and liveness API merge." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: "Avatar placeholder" }
---

# DEE-883 — Avatar Studio capture and representation experience

## Approved outcome

At Formation `>=20%`, the Human can enter a truthful, accessible Studio, complete the approved live ceremony, separately consent to representation material and preview/approve/regenerate/delete/export it.

## Work packages

### WP-1 — Eligibility and consent
Render authoritative 20% eligibility and separate liveness/avatar consent with explicit trust limitations.

### WP-2 — Capture and representation lifecycle
Implement randomized challenge UX, preview/approve/regenerate and provider/unavailable states.

### WP-3 — Recovery, accessibility and privacy proof
Cover denial, camera failure, false reject, adaptive timing, alternative path, deletion/export and E2E.

## Safety invariants

- No rigid single “say cheese” proof or identity badge.
- No training/publication before exact consent.
- Eligibility and liveness never change Formation or action authority.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused UI/security tests; `pnpm build`; `pnpm test:e2e`; accessibility/privacy review; `pnpm validate:canon`; PR governance.

