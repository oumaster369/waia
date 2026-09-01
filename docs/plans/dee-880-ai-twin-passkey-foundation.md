---
integrationIssue: DEE-880
integrationTitle: "AI-TWIN v1 — Passkey account and device authentication foundation"
branch: dee-880-ai-twin-passkey-foundation
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, integration, security, build, pr-governance]
approvalGates: [plan-approved, dee-873-human-gate, security-review, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "Blocked by DEE-873 Human decision.", nextAction: "Wait for approved RP/origin/recovery architecture." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-880 — Passkey account and device authentication foundation

## Approved outcome

Standards-aligned WebAuthn/passkey enrolment and authentication provide revocable account/device presence independently from camera liveness and identity claims.

## Work packages

### WP-1 — Challenge and credential persistence
Implement RP/origin checks, nonce/expiry/replay prevention and authenticator-held credential semantics.

### WP-2 — Device and recovery lifecycle
Add inventory, naming, last use, revocation, lost-device and safe recovery/step-up hooks.

### WP-3 — Security and UX proof
Test registration/auth/replay/origin/tenant/audit cases and Human-readable recovery.

## Safety invariants

- WAIA stores no authenticator private key.
- Device biometric unlock is not WAIA facial identity proof.
- Authentication success never changes Formation.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/integration/security tests; `pnpm build`; PR governance.

