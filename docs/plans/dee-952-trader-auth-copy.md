---
integrationIssue: DEE-952
integrationTitle: "AI-TRADER registration copy without Twin associations"
branch: dee-952-trader-auth-copy
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, build, targeted-unit, e2e, validate-pr-governance]
approvalGates: [plan-approved, human-merge, human-production-rollout]
includedIssues: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP-VALIDATION
  completedWorkPackages: [WP-COPY]
  remainingWorkPackages: [WP-VALIDATION, WP-PR]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-06"
  blockedReason: null
  nextAction: "Validate both form modes and unchanged primary WAIA copy; no merge or deployment."
provenance:
  createdFrom: chat
  humanApproval: "User 2026-09-06 requests visual/copy-only replacement of Twin associations on trader.waia.life; preserve form."
---

# DEE-952 — Trader-specific authentication copy

## Acceptance

Keep the shared form, fields, styling, email/OAuth handlers, mode identifiers, session semantics, entitlement and redirects unchanged. For existing context=trader only, use Register for AI-TRADER, Register and Sign in; remove Twin wording from headings, tab, submit and account-switch link. Keep primary WAIA context's Twin onboarding exactly as before. Do not infer real-account onboarding readiness or grant any entitlement from registration.

This is isolated from security PR559. Do not add it to that PR silently. Validate Trader signup/sign-in copy and fields, existing empty-name validation, no visible Twin text, unchanged WAIA copy, desktop/mobile overflow and focus/usability. Existing auth session tests remain applicable. No migrations, secrets, real accounts, corpus, scientific criteria, merge or deployment changes.
