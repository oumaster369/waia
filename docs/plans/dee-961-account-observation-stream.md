---
integrationIssue: DEE-961
integrationTitle: "Bounded authenticated account observation SSE with polling fallback"
branch: dee-961-account-observation-stream
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit, lint, typecheck, build, fixture-e2e, independent-exact-head-review]
approvalGates: [root-exact-head-review, authorized-integration-merge, human-production-rollout]
state:
  status: in-review
  currentWorkPackage: SSE-1
  completedWorkPackages: [SSE-1]
  remainingWorkPackages: []
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: "2026-09-10"
  blockedReason: null
  nextAction: "Root reviews the final commit and prepares the PR; keep DEE-961 open for production acceptance."
provenance:
  authoritativeBase: 9c976bdadded0f7de0bdfe891dc0573aac3be70c
  createdFrom: user-authorized-parallel-ai-trader-completion
  supersedes: null
---

# DEE-961 — Bounded account observation stream

## Authorized scope and design

Add tenant/Admin `/account-observation/stream` routes over the existing stored
projection contract, then mount one shared browser subscriber in both panels.
Use the existing complete authorization and five-field revision fence for every
read; export the existing read-only session resolver without React memoization
for repeated checks within one request. No access-policy or credential redesign.

Server limits: four full reads including the HTTP preflight, at most three emitted
projection/control frames, 25 seconds, 4 MiB per frame and 16 MiB per stream.
After preflight the body is discarded; the first consumer pull performs a fresh
fenced read. Subsequent pulls wait at least five seconds after the previous read.
No queued reads for a slow consumer. Each read uses its own disposed database
context. Abort/expiry cancels reads, bodies and timers and fences late completions.

Browser transport uses same-origin authenticated fetch, strict bounded framing,
validated DTOs and exact bindings. Clean EOF reconnects after five seconds;
transient failure falls back to three serialized JSON polls before retrying SSE.
Backoff caps at 30 seconds. HTTP401/403 and revoke events clear evidence and stop.
The existing scope hook prevents old-account/session publication. Transport state
is shown separately from observation age and completeness.

## Delivered files

New shared stream protocol/server handler, two thin stream routes and browser
streaming subscriber. Connected panel, shared hook/renderer and read dependency
use these additions. One uncached read-only session export preserves verified
`getUser` behavior. Focused stream/auth/route/component tests, browser transport
fixtures and the dated update to `dee-961-account-observation-ui.md` record evidence.
Collector, configured runtime, admission/coverage files and historical code are
unchanged.

## Validation and review evidence

- Focused suite: 111/111 PASS across eight account observation test files.
- Full ESLint: zero errors; 307 pre-existing warnings. Final changed-file lint and
  `git diff --check` PASS. Final `pnpm typecheck` PASS.
- Next production-mode build and Playwright: 3/3 PASS on loopback port 3217 using
  isolated `.data/dee961-stream-e2e.db` synthetic SQLite identity data. Browser
  tests cover mounted Admin/tenant parity, reconnect, stream failure/polling
  fallback, revoked clearing, anonymous Admin denial and historical isolation.
- Root read the server/client/route/auth implementation and current Workers types
  without a proven P1/P2 finding; final commit/delta review remains root-owned.
  A final preflight-body cancellation/expiry guard was added after the browser
  build, then the focused suite, typecheck and changed-file lint passed again.

## Limits and remaining issue acceptance

Tests use schema-valid browser fixtures and injected auth/storage boundaries;
they do not prove deployed Workers behavior, actual HTX data, real-account parity
or production collection. Production credentials/runtime, migrations, rollout,
science restart and capital operations are outside this integration. Native
fetch cancellation remains necessary to release network resources; ignored-abort
test adapters cannot overlap requests or publish late data. DEE-961 must remain
open until separately authorized production acceptance is complete.

Cloudflare/Workers best-practice and Supabase skills were used. Current Workers
types `5.20260908.1`, stream documentation, best practices, Wrangler 4.87.0 schema,
Supabase changelog HTML and verified SSR auth guidance informed the implementation.
