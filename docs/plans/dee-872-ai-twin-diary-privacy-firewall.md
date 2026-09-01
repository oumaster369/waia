---
integrationIssue: DEE-872
integrationTitle: "AI-TWIN v1 — Diary always-on observation and privacy firewall"
branch: dee-872-ai-twin-diary-privacy-firewall
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr]
requiredValidation: [lint, typecheck, unit, integration, security, canon, pr-governance]
approvalGates: [plan-approved, privacy-reviewed, human-merge]
includedIssues: []
state: { status: approved, currentWorkPackage: null, completedWorkPackages: [], remainingWorkPackages: [WP-1, WP-2, WP-3], prNumber: null, prUrl: null, lastValidatedGitSha: null, lastValidationAt: null, blockedReason: "DEE-130 must be merged and implementation explicitly started by the Human.", nextAction: "Wait for DEE-130 merge and coordinate ledger schema with DEE-871." }
provenance: { createdFrom: ROADMAP-AI-TWIN, gapRegistry: docs/gaps/ai-twin-v1-gap-registry.md, supersedes: "legacy Diary >=60 unlock for target runtime" }
---

# DEE-872 — Diary always-on observation and privacy firewall

## Approved outcome

Diary is available after initial privacy consent and can create private observations while raw text remains undisclosed unless a specific, revocable grant says otherwise.

## Work packages

### WP-1 — Consent and access migration
Separate Diary availability from legacy readiness and add per-entry raw-only/private-modelling intent.

### WP-2 — Observation and disclosure firewall
Route approved entries into DEE-871 provenance objects; enforce purpose-bound derived disclosure with inversion-risk controls.

### WP-3 — Regression and privacy proof
Test revocation, historical entries, tenant isolation, refusal and non-disclosure.

## Safety invariants

- Refusal/raw-only mode never penalizes Formation.
- Raw Diary is private by default and never silently enters Society/connectors.
- Legacy users gain no broader disclosure through migration.

## Validation matrix

`pnpm lint`; `pnpm typecheck`; focused unit/integration/security tests; `pnpm validate:canon`; PR governance.

