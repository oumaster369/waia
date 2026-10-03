---
integrationIssue: DEE-1231
integrationTitle: "HTX V5 read-only account-observation contract"
branch: dee-1231-htx-v5-readonly
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, native-postgres, mounted-e2e, lint, typecheck, build]
approvalGates: [plan-approved, independent-review, integration-ready, human-merge]
includedIssues:
  - id: DEE-1231
    role: work-package
    slug: WP-V5-READ-CONTRACT
    completionPolicy: manual-at-integration-ready
    status: pending
state:
  status: draft
  currentWorkPackage: WP-4
  completedWorkPackages: [WP-1, WP-2, WP-3]
  remainingWorkPackages: [WP-4]
  prNumber: 762
  prUrl: https://github.com/oumaster369/waia/pull/762
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Finish integrated review and exact-head CI for runtime, stored V3 display and native PostgreSQL acceptance; retain the venue/account and coordinated-release gates before activation."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1231: HTX V5 read-only contract slice

## Goal

Integrate bounded HTX V5 read-only futures observations into the existing account-observation runtime behind an optional server-owned, configuration-digest-bound assignment. This package preserves legacy snapshots when omitted, commits strict V3 projections through the existing repository when enabled, and remains unactivated for production collection.

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
- Add optional `htxV5` assignment settings (`enabled`, bounded fill contracts, and optional exact external UID) to the configuration digest and trusted assignment manifest. A fixed UID prevents template inventory reuse; generic V5 settings without a fixed UID may follow the existing trusted spot-template inventory path.
- Compose the V5 reader from the same protected credential handle, with transport-owned strict admission and current database/configuration authorization. Preserve shared credential ownership, track unsettled V5 readers against the existing per-account concurrency bound, and fence identity/permission changes before and after reads and before atomic commit.
- Require the whole V5 reader budget in the lease inequality and service validation. An enabled assignment emits V3 with required V5 projection; V1/V2 payloads remain readable and V1/V2 output remains unchanged when V5 is omitted or disabled. Classified V5 failures increase collection backoff; unknown pagination by itself does not.
- Validate V3 before the existing fenced repository commit. Show the stored projection through the shared Admin/cabinet component alongside existing spot and legacy derivatives. Durable database normalization, host activation, and venue-native acceptance remain follow-on work.
- Render separate USD aggregates, currency collateral, contract quantities, positions, orders, conditional orders and bounded fills. Preserve unavailable/partial/stale states, cap visible lists, and do not infer daily PnL or complete stop coverage. A positive-volume position shows an unconfirmed-protection warning; zero-volume rows do not.
- Prove non-empty V3 JSONB persistence and exact decimals/large IDs through real restricted writer/reader LOGINs on isolated PostgreSQL 17. Test tenant boundaries and rejected rotated/revoked/expired/superseded writes, including preservation of an accepted successor snapshot.
- The service waits for its exact opening, metadata admission, spot, legacy derivatives and V5 transport owners to settle before commit or failed-path lease release. Cleanup failure retains ownership and leaves recovery to lease expiry. A configured scheduler fail-stops while cleanup remains pending; the host bounds shutdown and reports failure rather than a false clean stop. The native shared-PostgreSQL regression proves ordinary handoff serialization and stale token fencing after expiry. A finite lease cannot guarantee HTTP non-overlap after a process crash, network partition or an abort-ignoring request that outlives the lease; deployment supervision and rate-budget acceptance must retain that limitation.
- Never persist the transport key digest or authorization receipt. The HTX UID is descriptive identity only. Caller retains protected credential-handle ownership.

## Explicit exclusions

This bounded slice does not complete DEE-1231. It adds no database migration, host/deployment activation, mode dispatch/capability inference, account-mode changes, trade/write routes, canonical execution/fill ingestion, or native HTX account acceptance. The key digest and UID evidence is transient and grants no durable authorization. It does not claim live production-read capability or full pagination/completeness. Venue tests use synthetic credentials and mocked fetch; storage acceptance uses a real isolated PostgreSQL 17 server with synthetic roles/data.

## Acceptance

- Only the six approved fixed GET routes can be constructed; callers cannot supply paths, methods, write parameters, or mode setters.
- The transport itself creates strict read-only admission internally; it does not accept an admission callback or caller-created venue receipt. `authorizeCurrent` is used only for current database/revision checks.
- Each response is returned only after fresh strict admission on both sides of the request and matching UID/key digest/binding. A configured expected external UID, if supplied, must match the discovered UID and is never compared with the WAIA spot account ID.
- The protected handle is revalidated before and after network work, and disposal/abort/timeout prevents publication. The V5 transport never disposes the shared credential handle.
- V5 settings alter the canonical configuration revision and are copied into the trusted manifest only after digest verification. Each enabled assignment satisfies `leaseTtlMs > readTimeoutMs * (3 + symbols + derivative families + legacy fill contracts) + 120000`, and its lease does not exceed the scheduler iteration.
- A configured expected HTX UID is accepted only on its exact configured account assignment; automatic inventory can reuse V5 settings only when no fixed UID is set.
- The service checks current lease/binding before and after V5 work and before commit. UID/binding/key or permission fences abandon the whole cycle; classified V5 errors preserve valid spot observations in V3 and increase backoff.
- Redirects, HTTP errors, oversized or malformed UTF-8 bodies, key/secret echoes, stale identity, and malformed request options fail with sanitized codes; late fetch/body cancellation is included in `settled()`.
- Builder inputs are validated as plain own-data records and primitive values; proxy traps, accessors, custom prototypes, and coercion hooks are rejected without invocation.
- Parsers reject malformed or duplicate-key JSON and invalid required fields with stable sanitized errors; numeric values and IDs retain their original lexemes.
- Asset mode is a raw enum with response time and is not mapped to endpoint capability or routing.
- Currency detail rows remain distinct from USD aggregates; duplicate currencies are rejected; contract volumes remain contract units; optional unknown values remain null.
- Position pagination is not invented. Order, algo, and fill cursors are returned as candidate cursors with completeness marked unknown until endpoint exhaustion is established.
- Targeted unit tests, mounted Admin/cabinet browser acceptance, restricted-role PostgreSQL tests, lint, typecheck, and build pass; no production/private API request is made.
- Independent review confirms the bounded diff and documentation. The full Linear issue remains open until actual account mode/UID/current read-only key mapping, rate-limit/cadence, deployment supervision across expiry recovery, and coordinated release/rollback acceptance are proven.

The rollout remains reader-first: deploy compatible Admin/cabinet readers and prove a V3-capable rollback baseline before any collector activation. The optional runtime writer remains unactivated. Native read-only HTX account acceptance remains a later gate; isolated PostgreSQL and browser fixtures do not substitute for it.

## Work package

### WP-1 — Bounded V5 read-only transport and response contract

Files: `lib/trader/account-observation/htx-read-admission.ts`, `lib/trader/account-observation/derivatives/htx-v5-read-contract.ts`, `lib/trader/account-observation/derivatives/htx-v5-read-transport.ts`, and focused unit tests for admission, builders/parsers, and transport.

Official route details are available in the HTX Open Platform: [asset mode](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957dd37de0), [balance](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-195703a12d5), [open orders](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957e082f23), [open positions](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957f1fbee4), [fills](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957e2a0e6a), and [algo orders](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-19b7345a20e).

The older announcement's multi-assets framing and current account-mode enum do not establish route availability for every mode. Mode stays separate from capability. Fills documentation conflicts on retention/window and required contract fields: the builder conservatively requires a contract and limits the query to 48 hours, while completeness remains unknown. Native successful reads must resolve these questions before production acceptance.

### WP-2 — V3 reader-first account-observation projection

Files: `lib/trader/account-observation/types.ts`, `lib/trader/account-observation/validation.ts`, `lib/trader/account-observation/derivatives/htx-v5-reader.ts`, and focused synthetic tests. The DTO validator is browser-safe and imports no server-only transport or Node modules. V3 requires its V5 projection; V1/V2 schemas continue to read unchanged, and a valid legacy derivatives projection remains optional in V3. Each component carries its own source/read times, bounded scope, partial/error state, and nullable values. List cursors remain candidate source data with `completeness: UNKNOWN`; a successful page is not recorded as complete history. Identity or permission fences reject the whole read. Unsupported or ordinary route failures stay scoped to their component when the remaining requests can be safely admitted. This is a reader/projection baseline only; the runtime/service composition is the separate WP-3.

### WP-3 — Digest-bound runtime/service integration

Files: `lib/trader/account-observation/coverage.ts`, `types.ts`, `runtime.ts`, `assignment-manifest.ts`, `postgres-assignments.ts`, `configured-runtime.ts`, `service.ts`, `validation.ts`, and focused tests. Optional protected V5 settings participate in the configuration revision and verified manifest. A fixed expected UID remains attached to one configured assignment and is excluded from automatic inventory reuse. The configured composition creates the V5 reader from the same protected handle, tracks its lifetime, and exposes only a fixed projection reader port. The service rechecks currentness around the whole read, validates a V3 snapshot, commits through the existing repository fence, and includes the fixed 120-second budget in lease validation. This package does not change database schema, collector-host launch configuration, browser sources, Admin/cabinet rendering, or deployment activation.

### WP-4 — Shared stored-snapshot display and native storage acceptance

Files: `components/trader/account-observation/account-observation-panel.tsx`, `htx-v5-account-section.tsx`, focused UI tests, mounted `tests/e2e/account-observation.spec.ts`, and the two existing observation PostgreSQL integration suites. Admin and cabinet consume the same stored V3 DTO without browser-to-exchange requests. Existing spot and legacy derivatives remain visible; revocation removes both legacy and V5 data. The native storage proof uses genuine restricted LOGINs, non-empty positions/orders/algo/fills, tenant isolation and stale-writer fences. All venue payloads remain synthetic. Completion of this software package does not close the native HTX or release acceptance gates above.
