---
integrationIssue: DEE-952
integrationTitle: "AI-TRADER registration copy and explicit account sign-out"
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
  currentWorkPackage: WP-PR
  completedWorkPackages: [WP-COPY, WP-SESSION-UI, WP-VALIDATION]
  remainingWorkPackages: [WP-PR]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-07"
  blockedReason: null
  nextAction: "Root review and explicitly scoped integration preparation; no publication, merge or deployment."
provenance:
  createdFrom: chat
  humanApproval: "User 2026-09-06 requests visual/copy-only replacement of Twin associations on trader.waia.life; preserve form."
---

# DEE-952 — Trader-specific authentication copy

## Acceptance

Keep the shared form, fields, styling, email/OAuth handlers, mode identifiers, session semantics, entitlement and redirects unchanged. For existing context=trader only, use Register for AI-TRADER, Register and Sign in; remove Twin wording from headings, tab, submit and account-switch link. Keep primary WAIA context's Twin onboarding exactly as before. Do not infer real-account onboarding readiness or grant any entitlement from registration.

This is isolated from security PR559. Do not add it to that PR silently. Validate Trader signup/sign-in copy and fields, existing empty-name validation, no visible Twin text, unchanged WAIA copy, desktop/mobile overflow and focus/usability. Existing auth session tests remain applicable. No migrations, secrets, real accounts, corpus, scientific criteria, merge or deployment changes.

## Authorized session UI extension — 2026-09-07

The Human subsequently explicitly requested full Trader completion and visible working sign-out, with parallel local implementation. DEE-952 is still unpublished: this extension is recorded before code and does not describe the enlarged package as copy-only. Preserve WP-COPY. Add a shared sign-out control to the exchange workspace, historical workspace and AdminShell, calling the existing same-origin POST /api/auth/sign-out. Block duplicate requests while pending, handle network/HTTP/invalid acknowledgements visibly, and navigate to the same-origin landing only after an acknowledged success. Do not change server session semantics, RLS, entitlement, global WAIA UI, streaming or account/trading authority in this work package.

Validation must exercise pending, duplicate click, HTTP/network/invalid-response failure, retry, success and presence on all three surfaces; isolated loopback SQLite browser checks must distinguish UI/session evidence from Supabase production proof. Known dependency: the existing route ignores Supabase signOut's returned error; report it to the root integrator as a separate server correctness blocker, not as a successful logout guarantee. No publication, merge, deployment, real session logout or private account access is authorized by this local extension.

Root integrator separately tracks the proven backend acknowledgement correction as DEE-957 (backend), with its own plan and local checkpoint commit. DEE-952 owns only the frontend change. Validate both together locally, but no publication eligibility or integration-train admission is implied by the shared validation worktree. The eventual integrated sign-out acceptance depends on DEE-957; otherwise a provider-returned error can still become a false HTTP success.

## Local validation — 2026-09-07

58 focused tests across Trader sign-out UI/route, existing landing and email/session tests passed. Full typecheck passed after correcting a test-only unsupported Testing Library selector option; full lint passed with 308 existing warnings and zero errors. Next production build and three loopback Playwright tests passed: exchange/historical presence and HTTP failure/retry, entitled SQLite session logout with subsequent protected 401, and platform-admin logout with subsequent protected 401. Browser setup required permitted local socket access after initial EPERM; no assertion was weakened. Database is isolated `.data/dee952-session-e2e.db`, fake AI, no real accounts. These are not Supabase production, account-streaming or full Trader readiness results. Raw provider error/partial-revocation behavior is separately covered by DEE-957.
