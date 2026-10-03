---
integrationIssue: DEE-1231
integrationTitle: "HTX V5 read-only account-observation contract"
branch: dee-1231-htx-v5-readonly
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, lint, typecheck, build]
approvalGates: [plan-approved, independent-review, integration-ready, human-merge]
includedIssues:
  - id: DEE-1231
    role: work-package
    slug: WP-V5-READ-CONTRACT
    completionPolicy: manual-at-integration-ready
    status: pending
state:
  status: draft
  currentWorkPackage: WP-1
  completedWorkPackages: []
  remainingWorkPackages: [WP-1]
  prNumber: 762
  prUrl: https://github.com/oumaster369/waia/pull/762
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Review the V3 reader/projection package, then integrate its read-only composition into the collector and scope persisted projections without enabling writes."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1231: HTX V5 read-only contract slice

## Goal

Define a bounded HTX V5 read-only transport and identity-evidence boundary for the documented futures reads. This package adds a fixed server-only GET transport composed with fresh exact-read-only metadata admission and the existing offline response projections. It remains disconnected from runtime collection and persistence.

## Scope

- Add a fixed GET-only static route set for asset mode, balances, open positions, ordinary open orders, open algo orders, and order details/fills.
- Add a server-only transport with six typed methods, fixed `api.hbdm.com`, signed GET requests, same-handle admission before and after each request, and no generic path/body API.
- Extend the admission owner with a non-enumerable `verifyReadIdentity` method while preserving the boolean `verifyReadAdmission` method and its enumerable surface.
- Bind successful response evidence to immutable full observation binding, key digest, discovered string HTX UID, exact read-only permission classification, and monotonic checked time. Keep this evidence transient and observation-only.
- Recheck the original protected credential handle's binding and key/secret fingerprint before and after network I/O. Dispose only the transport's internal admission/key references; leave shared-handle lifetime to its owner.
- Bound timeout and UTF-8 body size, reject redirects, scrub raw and JSON-escaped credential echoes, and track late fetch/body cancellation through settlement.
- Validate builder inputs without coercion, retain exact decimal and identifier lexemes, reject duplicate JSON keys, and project only documented response fields.
- Preserve asset-mode values as raw evidence separate from API capability. Preserve server response timestamps.
- Preserve returned pagination cursors as source data and report page completeness as unknown when exhaustion is undocumented; never manufacture whole-account completeness.
- Add synthetic fixtures for route methods/paths, mode enums, currency balances, mode-distinct positions, nullable values, order/protection fields, fills, invalid inputs, duplicate keys, cursor handling, route-specific page limits, fill-window scope, and cancellation settlement.
- Add a strict browser-safe V3 account-observation DTO whose V5 projection is required; keep V1/V2 read validation and storage shapes backward-compatible.
- Add a server-only bounded V5 reader that composes the fixed transport and offline parsers, checks binding/UID/key identity across requests, records per-component timing and partial/error/null states, and preserves unknown page coverage.
- Bound the whole reader to 31 V5 requests and 120 seconds, with at most eight configured fill contracts and a 24-hour window. Every independent request receives fresh admission; failed request owners are disposed and never reused.
- Enforce each response's requested page limit and reject known fills outside the requested window while retaining null fill timestamps as unknown. A timed-out or cancelled reader owner is terminal even while late fetch/body cleanup remains pending, so another read cannot overlap it.
- The 31 V5 route/page requests each include fresh metadata admission traffic (up to 217 total network requests per poll); cadence and rate-limit headroom must be proven before runtime activation.
- Never persist the transport key digest or authorization receipt. The HTX UID is descriptive identity only. Caller retains protected credential-handle ownership.

## Explicit exclusions

This bounded slice does not complete DEE-1231. The transport has no runtime wiring, database/persistence/migrations, mode dispatch/capability inference, account-mode changes, trade/write routes, UI, canonical execution/fill ingestion, or native account acceptance. The key digest and UID evidence is transient and grants no durable authorization. It does not claim live production-read capability or full pagination/completeness. Tests use synthetic credentials and mocked fetch only.

## Acceptance

- Only the six approved fixed GET routes can be constructed; callers cannot supply paths, methods, write parameters, or mode setters.
- The transport itself creates strict read-only admission internally; it does not accept an admission callback or caller-created venue receipt. `authorizeCurrent` is used only for current database/revision checks.
- Each response is returned only after fresh strict admission on both sides of the request and matching UID/key digest/binding. A configured expected external UID, if supplied, must match the discovered UID and is never compared with the WAIA spot account ID.
- The protected handle is revalidated before and after network work, and disposal/abort/timeout prevents publication. The V5 transport never disposes the shared credential handle.
- Redirects, HTTP errors, oversized or malformed UTF-8 bodies, key/secret echoes, stale identity, and malformed request options fail with sanitized codes; late fetch/body cancellation is included in `settled()`.
- Builder inputs are validated as plain own-data records and primitive values; proxy traps, accessors, custom prototypes, and coercion hooks are rejected without invocation.
- Parsers reject malformed or duplicate-key JSON and invalid required fields with stable sanitized errors; numeric values and IDs retain their original lexemes.
- Asset mode is a raw enum with response time and is not mapped to endpoint capability or routing.
- Currency detail rows remain distinct from USD aggregates; duplicate currencies are rejected; contract volumes remain contract units; optional unknown values remain null.
- Position pagination is not invented. Order, algo, and fill cursors are returned as candidate cursors with completeness marked unknown until endpoint exhaustion is established.
- Synthetic targeted tests, scoped lint, typecheck, and build pass; no production/private API request is made.
- Independent review confirms the bounded diff and documentation. The full Linear issue remains open until separately approved runtime identity/admission, persisted projection, and native read-only acceptance work is complete.

The follow-on rollout is reader-first: continue the authorized read-only scope by composing the transport with the current account-observation reader and preserving UID/binding/freshness evidence through collection before proposing persistence work. After that path is independently reviewed, scope storage for orders, protection, and fills. Native read-only account acceptance remains a later gate; this draft does not claim it.

## Work package

### WP-1 — Bounded V5 read-only transport and response contract

Files: `lib/trader/account-observation/htx-read-admission.ts`, `lib/trader/account-observation/derivatives/htx-v5-read-contract.ts`, `lib/trader/account-observation/derivatives/htx-v5-read-transport.ts`, and focused unit tests for admission, builders/parsers, and transport.

Official route details are available in the HTX Open Platform: [asset mode](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957dd37de0), [balance](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-195703a12d5), [open orders](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957e082f23), [open positions](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957f1fbee4), [fills](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957e2a0e6a), and [algo orders](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-19b7345a20e).

The older announcement's multi-assets framing and current account-mode enum do not establish route availability for every mode. Mode stays separate from capability. Fills documentation conflicts on retention/window and required contract fields: the builder conservatively requires a contract and limits the query to 48 hours, while completeness remains unknown. Native successful reads must resolve these questions before production acceptance.

### WP-2 — V3 reader-first account-observation projection

Files: `lib/trader/account-observation/types.ts`, `lib/trader/account-observation/validation.ts`, `lib/trader/account-observation/derivatives/htx-v5-reader.ts`, and focused synthetic tests. The DTO validator is browser-safe and imports no server-only transport or Node modules. V3 requires its V5 projection; V1/V2 schemas continue to read unchanged, and a valid legacy derivatives projection remains optional in V3. Each component carries its own source/read times, bounded scope, partial/error state, and nullable values. List cursors remain candidate source data with `completeness: UNKNOWN`; a successful page is not recorded as complete history. Identity or permission fences reject the whole read. Unsupported or ordinary route failures stay scoped to their component when the remaining requests can be safely admitted. This is a reader/projection baseline only: collector wiring and durable schema/UI work remain outside this package.
