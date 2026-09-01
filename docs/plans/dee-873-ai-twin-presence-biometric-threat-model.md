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
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "DEE-130 must be merged and implementation explicitly started by the Human.", nextAction: "Prepare the threat/DPIA/vendor evidence packet; stop for Human decision before DEE-882." }
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

## Validation matrix

`pnpm validate:canon`; `git diff --check`; security/privacy traceability review; PR governance.

