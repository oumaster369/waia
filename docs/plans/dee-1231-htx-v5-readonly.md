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
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Publish the independently reviewed static contract in a draft PR; keep the issue open for runtime admission, persisted observations, and native account acceptance."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1231: HTX V5 read-only contract slice

## Goal

Define a bounded, offline implementation contract for the documented HTX V5 futures reads so a later integration can safely add current account observations. This work package covers fixed typed request builders and strict response projections only.

## Scope

- Add a fixed GET-only static route set for asset mode, balances, open positions, ordinary open orders, open algo orders, and order details/fills.
- Validate builder inputs without coercion, retain exact decimal and identifier lexemes, reject duplicate JSON keys, and project only documented response fields.
- Preserve asset-mode values as raw evidence separate from API capability. Preserve server response timestamps.
- Preserve returned pagination cursors as source data and report page completeness as unknown when exhaustion is undocumented; never manufacture whole-account completeness.
- Add synthetic fixtures for route methods/paths, mode enums, currency balances, mode-distinct positions, nullable values, order/protection fields, fills, invalid inputs, duplicate keys, and cursor handling.

## Explicit exclusions

This bounded slice does not complete DEE-1231. It does not add network or database calls, transport/admission wiring, credential or UID binding, mode dispatch, account-mode changes, trade/write routes, persistence/migrations, UI, canonical execution/fill ingestion, or native account acceptance. It does not claim live production-read capability or full pagination/completeness. Do not read or publish account data as part of this work package.

## Acceptance

- Only the six approved fixed GET routes can be constructed; callers cannot supply paths, methods, write parameters, or mode setters.
- Builder inputs are validated as plain own-data records and primitive values; proxy traps, accessors, custom prototypes, and coercion hooks are rejected without invocation.
- Parsers reject malformed or duplicate-key JSON and invalid required fields with stable sanitized errors; numeric values and IDs retain their original lexemes.
- Asset mode is a raw enum with response time and is not mapped to endpoint capability or routing.
- Currency detail rows remain distinct from USD aggregates; duplicate currencies are rejected; contract volumes remain contract units; optional unknown values remain null.
- Position pagination is not invented. Order, algo, and fill cursors are returned as candidate cursors with completeness marked unknown until endpoint exhaustion is established.
- Synthetic targeted tests, scoped lint, and typecheck pass; no production or private API request is made.
- Independent review confirms the bounded diff and documentation. The full Linear issue remains open until separately approved runtime identity/admission, persisted projection, and native read-only acceptance work is complete.

## Work package

### WP-1 — Static V5 read request and response contract

Files: `lib/trader/account-observation/derivatives/htx-v5-read-contract.ts` and `tests/unit/htx-derivatives-v5-read-contract.test.ts`.

Official route details are available in the HTX Open Platform: [asset mode](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957dd37de0), [balance](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-195703a12d5), [open orders](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957e082f23), [open positions](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957f1fbee4), [fills](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-1957e2a0e6a), and [algo orders](https://www.htx.com/en-us/opend/newApiPages/?id=8cb89359-77b5-11ed-9966-19b7345a20e).

The older announcement's multi-assets framing and current account-mode enum do not establish route availability for every mode. Mode stays separate from capability. Fills documentation conflicts on retention/window and required contract fields: the builder conservatively requires a contract and limits the query to 48 hours, while completeness remains unknown. Native successful reads must resolve these questions before production acceptance.
