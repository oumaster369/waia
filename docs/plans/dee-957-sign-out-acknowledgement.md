---
integrationIssue: DEE-957
integrationTitle: "Propagate auth sign-out failures truthfully"
branch: dee-957-sign-out-acknowledgement
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, build, targeted-unit, e2e]
approvalGates: [plan-approved, human-merge, human-production-rollout]
includedIssues: []
state:
  status: in-progress
  currentWorkPackage: WP-PR
  completedWorkPackages: [WP-ACKNOWLEDGEMENT, WP-VALIDATION]
  remainingWorkPackages: [WP-PR]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-07"
  blockedReason: null
  nextAction: "Validate local provider failure acknowledgements; no publication or deployment."
provenance:
  createdFrom: chat
  humanApproval: "User requests full Trader completion; root integrator explicitly admits proven returned-error fix and creates DEE-957 backend."
---

# DEE-957 — truthful sign-out acknowledgement

## Context and scope

The existing POST /api/auth/sign-out ignored Supabase auth.signOut's returned error and could report ok=true on provider failure. Root authorized the minimal correction before code. This separate backend issue is linked to DEE-952 UI and DEE-920 by the integrator. It is locally staged in the isolated DEE-952 validation worktree, not a published Integration Train or an authorization for merge/deployment.

## Acceptance

Handle returned provider errors, thrown failures and absent configured clients as generic HTTP503 with ok=false and no raw provider details. Do not deliberately delete the local WAIA session or apply staged response cookies on that failed path. A remote provider may have partially revoked state: report uncertainty, not an active-session guarantee. Preserve provider default sign-out scope and successful local-session deletion/cookie patches. Preserve provider-unconfigured local-only logout. Add route regressions proving each outcome. Local SQLite browser logout/401 tests are not Supabase production evidence or proof of immediate invalidation of already-issued access tokens.

## Do not

No RLS, schema, middleware, session lifetime/scope changes, real accounts, credentials, traffic, merge or deployment. No provider error strings in response/logs. A later local deletion failure after provider success remains a non-success exception, not a success assertion; distributed atomic revocation is not claimed.

## Local validation — 2026-09-07

Five route regression cases passed (returned error, thrown error, configured client missing, acknowledged provider success, unconfigured local-only path); combined UI/landing/auth run passed 58 tests. Full typecheck, lint (zero errors, 308 existing warnings), Next build and three isolated SQLite browser tests passed with DEE-952 UI. No Supabase production session was created, inspected or revoked. Independent review and publication admission remain outstanding.

## Synchronized validation — 2026-09-09

Local validation branch incorporates origin/main90de233a. Five acknowledgement
route tests still pass; cumulative logout/admin/observation suite32/32 PASS,
typecheck PASS, Next build PASS, three SQLite browser tests PASS, including
post-logout401 and subsequent same-account login with authorized metadataHTTP200.
Independent scoped review found no P1/P2. Provider global scope is preserved;
already-issued access JWTs are not claimed immediately invalidated. No live
Supabase session or credential access, scientific change, push, merge or deployment.
