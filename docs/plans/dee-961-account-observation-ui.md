---
integrationIssue: DEE-961
integrationTitle: "Shared account observation UI — bounded local slice"
branch: dee-960-account-observation-core
riskTier: T2
prPolicy: integration-with-dee-960-after-review
executionSurfaces: [local]
requiredValidation: [focused-unit, lint, typecheck, build, e2e, independent-review]
approvalGates: [human-merge, human-production-rollout, authenticated-route-integration]
provenance:
  authoritativeBase: bb1a06620ac7f75cd865d376d5b1416164c2fe6d
  createdFrom: user-approved-local-dee-960-storage-and-dee-961-interfaces-2026-09-09
state:
  status: in-progress
  prNumber: null
  prUrl: null
  blockedReason: release-packaging-runtime-collector-and-production-acceptance-pending
---

# DEE-961 — Shared account observation UI

## Local verification result — 2026-09-09

Mounted browser checks now PASS 3/3, including automatic Admin/tenant observation
updates and revoke clearing, anonymous Admin denial, and historical/exchange
effect isolation. This run completed a fresh Next production-mode build against
an isolated synthetic SQLite identity database, not a production/OpenNext rollout.
The transport responses are explicit browser fixtures. Separately, actual local
PostgreSQL17 repository/reader checks PASS 27/27, and the cumulative DEE-960/961
unit/integration run PASS 153/153. Typecheck and scoped ESLint PASS.
Root-owned authenticated binding/projection routes are now implemented with a
dedicated SELECT-only database adapter; absence of the dedicated connection fails
closed. Existing entitlement/membership/operator reads are independently required.
Updates use automatic bounded polling, not a new SSE endpoint. No deployed account
stream or connected HTX collector is claimed. Historical evidence below records
the preceding development stages; these local results supersede their pending
build/E2E statements, not the remaining production/collector obligations.

## Acceptance

User approved local DEE-960 storage/adapters and DEE-961 interfaces on 2026-09-09.
This bounded slice supplies one presentational renderer, injected subscription
hook and reusable polling transport for both Admin and tenant. Subsequent local
integration mounts the connected component in the exchange workspace and a new
protected Admin page; this is NOT a deployed or production-accepted stream.
Root integrator owns DEE-960, security and final integration gates.
No production writes, account access, migrations, deployment, push or merge here.

## Local implementation

- `components/trader/account-observation/use-account-observation.ts`:
  injected subscription only, no URL or network calls. State distinguishes initial
  loading, disconnected, current, partial, error, stale and revoked. A bounded timer
  expires initial loading and ages evidence even without incoming stream events.
- Exact organization/credential/account/credential-revision/configuration-revision
  bindings must match. Switching scope or subscription identity hides old evidence
  during render, aborts/unsubscribes old resources and ignores late callbacks.
  Returning to the same account after logout does not resurrect cached evidence.
- Revocation clears data, aborts and unsubscribes; subsequent old events cannot
  revive it. Disconnection/error may retain last received evidence, clearly labeled.
  Duplicate/older completion timestamps do not replace newer evidence. Partial new
  observations replace the whole payload rather than retaining successful old parts.
- `account-observation-panel.tsx`: one shared renderer, exact observation ID,
  per-component completeness/source times/read windows, balances, balance-derived
  holdings, open orders and symbol-scoped trades. Numeric strings are preserved.
  Missing data is never labeled zero. No computed PnL/cost basis/equity/strategy
  positions or trading controls. Visible component lists cap at 100 with explicit
  received-count truncation; authenticated transport must also bound total payload.
- `polling-subscriber.ts`: caller supplies a relative `/api/...` path and fetch
  implementation; no existing endpoint is assumed. Only exact binding IDs/revisions
  enter query parameters. Requests are GET, same-origin cookies, no-store and
  redirect:error; no credentials or bearer tokens enter the URL. A 200 response is
  a direct DTO validated with DEE-960's strict parser and exact binding; 204 means
  no observation, never a fabricated zero; 401/403 clears/terminates access.
  Response buffering is capped at 4 MiB; body reading is abortable. Timeouts and
  exponential capped retries are bounded with no overlapping polls. An injected
  fetch ignoring abort cannot publish its late reply or spawn parallel requests.
  Native fetch abort behavior remains required for releasing network resources.
- `connected-account-observation-panel.tsx`: fetches the active stored binding
  before observation polling. Tenant `/api/trader/account-observation/binding`
  uses credential/account IDs; Admin `/api/trader/admin/account-observation/binding`
  also specifies organization. The root-owned GET routes return a direct validated
  binding, 204 not configured, 401/403 access denied, or 503 unavailable. Binding
  reads have 10-second timeout, 8 KiB body cap, abort/no late publication, and
  capped retry. Missing configuration is explicitly labeled, not a zero balance.
- `components/trader/trader-workspace.tsx`: mounts only for an active credential
  in ExchangeTraderWorkspace; the separate HistoricalTraderWorkspace remains
  unchanged. Existing balance/position/trade panels are retained and explicitly
  labeled separately collected manual diagnostic snapshots, not the shared stream.
- `/admin/account-observation` reuses the existing server-protected admin layout
  and authorized organization selector. Operator enters metadata record/account
  IDs (not API keys); each API request separately authorizes exact access. Org
  changes clear prior account selection. No existing Human/trading UI is changed.

## Integration obligations (not completed)

The supplied polling subscriber consumes a validated projection and has bounded
reconnects, abort, unsubscribe and classified errors. Another injected subscriber
must maintain the same contract.
TypeScript types are not a network validator or an authorization boundary. The
read route must independently check operator/tenant membership and current exact
account binding, including revocation, and return the same immutable observation to
both surfaces. Raw venue responses and credentials may never enter this port.

Actual page owners must set binding=null/unmount immediately on logout or access
loss and remount on authenticated session changes. UI logout does not revoke an
exchange credential or stop a server collector/trading process. Server authorization
is mandatory regardless of the frontend's checks.

Still required: cumulative verification of root-owned DEE-960 routes and bounded
collector/scheduler; browser E2E proving mounted scope/refresh/logout and identical
IDs/metrics; independent exact-head review and all PR gates; separately authorized
production rollout and real-account acceptance. No fixture test establishes real
HTX streaming, collector deployment or live trading readiness.

## Tests and validation

`tests/unit/account-observation-ui.test.tsx` uses explicitly mocked subscriber
events and a fake clock. Focused cases cover all five binding fields, revocation,
late replies, empty/missing data, decimal strings, bounded initial loading, stale
expiry, generic exception handling, cleanup and renderer parity. These are local
component tests, not PostgreSQL, real exchange or production acceptance evidence.

`tests/unit/account-observation-polling.test.ts` exercises only fake fetch:
same-origin options, exact identity, malformed/raw/oversize response rejection,
401/403 terminal revoke, missing versus zero, backoff, no overlap, cancellation
of response bodies and late replies, and unsafe endpoint rejection. No network
requests have been made by these tests. Final combined run: 38/38 tests PASS
(21 UI and 17 transport, 2026-09-09). Scoped ESLint and diff whitespace check
pass; typecheck/build and mounted-page E2E are cumulative
integrator-owned gates, not claimed complete by this slice.

Connected wrapper adds 13 focused fake-HTTP tests, all PASS; combined UI/transport
suite 51/51 PASS. Cases cover binding authorization/identity, 204 configuration
absence, 503/backoff, timeout/no overlap, old binding responses, target change and
projection denial clearing previously rendered evidence. Three Playwright cases
were added for mounted Admin/tenant automatic update parity and revocation,
anonymous Admin page denial, and historical/exchange effect isolation. Their HTTP
payloads are explicit fixtures; execution and outcome are owned by the root's
single cumulative build/E2E run, not yet claimed PASS here.

Supabase skill/checklist and [SSR auth guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
reviewed 2026-09-09: no client-side authorization based on stored JWT claims;
request-side access must be validated independently; cache isolation remains a
server obligation as well as no-store request behavior. Changelog markdown fetch
returned unsupported content-type; HTML fallback inspected, no relevant API
change used by this framework-neutral fetch adapter. No Supabase SDK/schema
change or database call in this UI slice.

## Do NOT

Do not mount a mock subscriber in production, claim live readiness, change science
calculation, synthesize balances or PnL, add private credentials, or bypass tenant,
operator or Human authority checks.
