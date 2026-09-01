---
integrationIssue: DEE-873
integrationTitle: "AI-TWIN v1 — Presence, biometric privacy and Avatar threat model"
branch: dee-873-ai-twin-presence-biometric-threat-model
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr, human-security-review]
requiredValidation: [canon, security-review, diff-check, pr-governance]
approvalGates: [plan-approved, human-dpia-vendor-retention-decision, human-merge]
includedIssues: []
state: { status: in_progress, currentWorkPackage: null, completedWorkPackages: [WP-1, WP-2, WP-3], remainingWorkPackages: [], prNumber: 542, prUrl: "https://github.com/oumaster369/waia/pull/542", lastValidatedGitSha: "77b842dfe36505221b6847466dfa6c51f53b8dd7", lastValidationAt: "2026-09-01", blockedReason: "Human review/merge and explicit D1-D5 presence/privacy decision are required before DEE-882.", nextAction: "Wait for PR #542 CI/review and the Human D1-D5 decision; do not activate or select biometric processing." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: null }
---

# DEE-873 — Presence, biometric privacy and Avatar threat model

## Approved outcome

A reviewed threat/privacy architecture separates liveness, authentication, uniqueness and legal identity and defines the only admissible path to passkey/liveness/avatar implementation.

## Work packages

### WP-1 — Claims and threat model
Map replay, injection, virtual camera, coercion, account takeover, recovery and overclaim risks.

### WP-2 — Privacy/vendor evaluation
Specify data separation, minimization, retention/deletion/export, accessibility, bias/false-reject evidence and DPIA/legal questions.

### WP-3 — Human decision packet
Present alternatives, residual risk, DARK-by-default activation and explicit go/no-go decisions.

## Safety invariants

- No implementation/vendor activation occurs in this issue.
- No face deduplication, emotion/personality inference or identity/uniqueness claim.
- DEE-882 stays blocked until the Human records approval.

## Safe-execution boundary

- Base: `origin/main@8170dc3878d4cade59cc02422d2df022ee300c88`.
- This batch is documentation/security-analysis only and owns no runtime, schema, migration, dependency, authentication, deployment or production surface.
- AI-TRADER has unconditional priority. Any discovered overlap with its active work stops this batch rather than changing either program.

## Validation matrix

`pnpm validate:canon`; `git diff --check`; security/privacy traceability review; PR governance.
