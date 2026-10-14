---
integrationIssue: DEE-1249
integrationTitle: "Show persisted financial history with honest coverage in the English cabinet"
branch: dee-1249-cabinet-financial-history
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, focused-unit, mounted-chromium, build]
approvalGates: [independent-review, backend-main, reader-first-rollout, human-merge]
includedIssues: []
state:
  status: in-progress
  currentWorkPackage: WP-1
---

## Goal and boundary

Show already persisted bill records and collection coverage in the shared tenant/admin ConnectedAccountObservationPanel. Root authorized local implementation based on reviewed backend commit bdb20aeb1a7552b5de645eb882de1c704a911712; this is a stacked source preparation only, with no push or PR until DEE-1248 reaches main. No unresolved product choices: use explicit Refresh/Load more, 20 rows per stream per page and at most 200 rows per stream / 10 pages per view.

The latest-snapshot HtxV5BillsSection stays separate. History retains raw signed amount strings, currency, UTC dates, provider category/type, contract and source collection window/revision. Never calculate PnL, FX, totals or complete-history coverage. Current NOT_CONFIGURED must not hide valid older history. An exhausted cursor describes only persisted snapshot pagination.

## Implementation

- Add a scoped client history hook and English responsive section under components/trader/account-observation. Use only the new same-origin GET financial-history route, strict shared response validation, 1MiB read limit, bounded deadline and explicit pagination. No storage, venue calls, backend changes or credentials.
- Mount only under an authorized current observation with its exact binding and UID. Key the child on every binding field, UID, transport owner and optional session generation; clear before rendering a different scope. Abort old requests and ignore late responses; authorization rejection also revokes the shared account panel. Existing callers unmount/reset target on session end; expose sessionKey for a same-target session replacement.
- Refresh clears the prior snapshot before requesting a new one. Deduplicate exact identical rows; conflicting duplicates, identity mismatches, invalid or repeated cursors fail closed. Bound accumulated records, coverage and requests. Generic errors never expose response bodies.
- Distinguish loading, empty, current NOT_CONFIGURED, unavailable, error and revoked states; show receipt/collection times and UNKNOWN completeness explicitly.

## Validation and risk

Focused rendered tests cover synchronous selection/session/revision/UID reset, stale responses that ignore abort, paging/dedupe/caps, malformed and mismatched pages, 204/503/401/403, refresh and NOT_CONFIGURED with retained data. Run the existing connected panel suite and focused latest-snapshot tests. Add an isolated mounted Chromium scenario for tenant/admin navigation, paging, partial/empty/revocation, mobile layout and absence of account writes. Only the owned local server/SQLite fixture may be created and cleaned. Run typecheck, lint and normal Node22 build with an owned APFS dependency clone; no full local unit campaign.

Source readiness is separate from production acceptance. Compatible migration/isolated reader and backend caller must ship before this UI; root owns integration/release acceptance. No production or provider access occurs during this work.

## Local source handoff, 2026-10-14

- Focused rendered regression: 50 assertions across three suites passed (20 history + 14 shared connected-panel + 16 latest-snapshot). A subsequent 22-assertion history pass adds streamed UID/revocation and revision reset; counts overlap, so this is 52 distinct focused assertions.
- One mounted Chromium scenario passed using the normal built app and isolated local SQLite authentication: tenant/admin GET history, exact raw decimal, pagination, account switching, empty partial coverage, NOT_CONFIGURED with older rows, 401/403-style revocation, mobile no horizontal overflow, and no account writes. Screenshots were inspected at desktop/mobile widths. All observation/history responses were synthetic transport fixtures; they prove neither production reader acceptance nor real financial data.
- Normal Node22 Turbopack build, typecheck and full lint passed. Full lint has 337 existing warnings and zero errors; no new feature warnings. Focused tests also exercise timeout/no-overlap, malformed/mismatched/oversize pages, conflicting duplicates, repeated cursor rejection, 10-page/200-row caps, and abort-resistant replies after session/target changes.
- Evidence is retained in the reviewed UI validation packet. Only this worktree's port3219 server and dee1249-ui SQLite fixture were used. Owned local resources are removed at handoff.
- The initial UI handoff was based on reviewed bdb20aeb. The backend is now merged in #788 as 001b89bc1dba1ed3417c8530f4f8a21a8c82f0bf, and the UI was rebased with identical code and tests. Root owns the separately controlled reader-first release and production acceptance.


## Release packaging prerequisite

The first actual linux/amd64 builds of the merged history backend failed because both observation Dockerfiles omitted `patches/postgres@3.4.9.patch`, which the frozen package manifest and lockfile already require. This change copies that exact existing file before dependency installation in both images, and admits only that file through the projection image context. The package manifest, lockfile and driver patch are unchanged. A focused regression derives declared patch paths from the manifest, rejects both original image contexts and passes with the correction. Actual candidate image builds and final merged-release identities remain separate release gates.
