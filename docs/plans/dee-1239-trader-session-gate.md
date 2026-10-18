---
integrationIssue: DEE-1239
integrationTitle: "AI-TRADER: gate account connection on verified session"
branch: dee-1239-trader-session-gate
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, browser, validate-canon, independent-review, required-ci]
approvalGates: [independent-review, required-ci, separately-verified-production-release]
state:
  status: in-review
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-3]
  remainingWorkPackages: [WP-4, WP-2]
  prNumber: 781
  prUrl: https://github.com/oumaster369/waia/pull/781
  lastValidatedGitSha: 90dd81bc50c4ec80ddba224ac07eca69be8705a6
  lastValidationAt: "2026-10-13T09:10:00Z"
  blockedReason: null
  nextAction: "Complete browser and independent review of the inline-review fixes, then publish one consolidated candidate and require exact-head CI before source integration; production remains separately verified."
provenance:
  createdFrom: "User-requested live onboarding verification and DEE-1239"
  gapRegistry: null
  supersedes: null
---

# DEE-1239 — Trader session-aware account connection

## Context and goal
The unauthenticated Trader workspace displayed HTX key inputs after the credential-list API rejected access. Its header also looked signed in. Separate access states must precede the connection form, while authorized new and existing accounts retain their current observation workflow.

## WP-1 — Scope and implementation
- Distinguish loading, allowed, unauthenticated, forbidden and unavailable credential-list outcomes.
- Hide credential fields and account actions until access is confirmed. Clear held credentials on authorization loss; retain existing generation fencing for stale requests.
- Route unauthenticated users to the canonical Trader landing, whose existing authentication flow returns to the Trader workspace.
- Keep authenticated connection/replacement/revocation behavior and all server authorization unchanged.
- Identify exchange inputs explicitly and request new-password autofill semantics for the secret. Browsers may override autocomplete hints.

No trading, venue permission, schema, key, collection schedule or observer deployment change is included.

## Acceptance and validation
Focused UI tests cover pending access, 401/403/transient failures, safe recovery, existing accounts, auth loss, and synthetic Read+Trade connection without trading requests. Browser coverage verifies the actual landing and return path. Full lint, typecheck and Next build precede PR readiness; full unit and required integration checks run once in PR CI. Independent review binds the exact source files.

## WP-2 — Delivery and recovery
One issue/PR to main covering session-gated onboarding and the narrowly required release compatibility fix. Source integration and production release are separate results. Any later Worker-only release requires a fresh read confirming PAPER_LOOP_ENABLED=0 and must preserve that disabled value, current projection, observation configuration and all nonrelease variables. The committed Wrangler configuration declares PAPER_LOOP_ENABLED=1, so a generic deployment using repository defaults is not admitted; use the separately reviewed preservation procedure. Do not activate the unqualified financial observer. A source revert through a reviewed PR is available for the isolated UI change.


## WP-3 — Preserve observation during independent web releases

Release review found that the Worker used `WAIA_RELEASE_SHA` both as its own source identity and as the release field in the authenticated projection tuple. Updating only the web Worker would cause the unchanged projection service to reject the request. Keeping an old Worker SHA or disabling projection would misrepresent the release or interrupt working accounts.

Add `WAIA_ACCOUNT_OBSERVATION_PROJECTION_RELEASE_SHA` as an explicit pin to the already accepted backend artifact. Only an absent variable retains the existing `WAIA_RELEASE_SHA` fallback; an empty or malformed explicit pin must fail closed. The projection protocol continues to require the same exact audience, backend release, epoch, key id and HMAC in both directions. Authorization, binding resolution, deadlines and connection limits stay unchanged.

The operator must derive the backend pin from a fresh accepted active tuple and independently bind it to the existing backend artifact. This does not authorize arbitrary backend substitution or waive compatibility verification. The new Worker source release remains its actual merged SHA. Preserve projection1, PAPER0, all other variables, secret bindings, schedules and running containers. An exact previous Worker version is the compatible rollback while the backend remains unchanged.

Root architect review selected the separate backend identity after tracing the client and server tuple comparison; independent final source/protocol review is required. Targeted tests must prove absent-only fallback, explicit valid pin with a different web SHA, refusal of empty/invalid pins before a projection connection, preserved unauthorized refusal, and real synthetic protocol matching/mismatch. No provider or exchange call belongs to these tests.

## WP-4 — Review corrections and runtime sign-in

A mutation response with HTTP 403 can represent `CSRF_INVALID` rather than missing entitlement. Only 401 or 403 with `FORBIDDEN` clears authorized workspace state; other errors retain the connection or revoke context and show a retry message. An authenticated user without Trader entitlement retains sign-out so they can switch accounts.

The static page remains `<TraderWorkspace />`. Its relative sign-in link resolves through a tiny dynamic GET route that reads the configured Trader origin at request time. With no configured origin it redirects to the request origin root; malformed configuration fails closed. No user-supplied return destination, auth lookup, database call, or account mutation is introduced. Runtime environment lookup must avoid Next public-variable build-time substitution.

Validate CSRF refusal, forbidden sign-out, redirect configuration/fallback, the unchanged static CPU boundary and the full mounted Trader browser journey. Superseded CI and review findings remain recorded; they do not qualify new source bytes.
