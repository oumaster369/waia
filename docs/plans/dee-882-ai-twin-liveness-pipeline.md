---
integrationIssue: DEE-882
integrationTitle: "AI-TWIN v1 — Active liveness ceremony and Avatar evidence pipeline"
branch: dee-882-ai-twin-liveness-pipeline
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr, human-production-activation]
requiredValidation: [lint, typecheck, unit, integration, security, canon, pr-governance]
approvalGates: [plan-approved, dee-873-human-gate, security-review, human-merge, human-production-activation]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-873 Human decision and DEE-880.", nextAction: "Remain DARK until threat/privacy/vendor approval and passkey foundation." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-882 — Active liveness ceremony and Avatar evidence pipeline

## Approved outcome

An approved server-challenge ceremony evaluates live presence with explicit limits, minimized evidence and robust replay/injection defenses; it proves neither uniqueness nor legal identity.

## Work packages

### WP-1 — Challenge state machine
Implement signed nonce/expiry, randomized 2–3 actions, adaptive timing, rate limits and idempotency.

### WP-2 — PAD/client signals and evidence lifecycle
Integrate only the Human-approved path, separate liveness evidence from avatar material and add recovery/review.

### WP-3 — Adversarial and privacy proof
Test replay, stale/reordered/pre-recorded challenges, virtual-camera/injection, false rejects, deletion/export and DARK activation.

## Safety invariants

- No implementation before DEE-873 approval and no production activation in merge.
- No emotion/personality inference, default deduplication or identity/uniqueness claim.
- The result states exactly what was and was not established.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/integration/security tests; `pnpm validate:canon`; PR governance; Human production gate.

