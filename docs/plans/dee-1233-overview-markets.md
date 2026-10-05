---
integrationIssue: DEE-1233
integrationTitle: "Spot and Futures on the main Admin Overview"
branch: null
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [targeted-unit, mounted-e2e, lint, typecheck, build]
approvalGates: [independent-review, parent-integration-decision]
state:
  status: draft
  currentWorkPackage: WP-OVERVIEW
  completedWorkPackages: []
  remainingWorkPackages: [WP-OVERVIEW]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: "Isolated local preparation based on frozen draft PR762; no publication or rollout authority."
  nextAction: "Complete local mounted acceptance and retain exact delta for a later integration decision."
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

# DEE-1233 — Spot and Futures on the main Admin Overview

Local implementation preparation for DEE-1233 / acceptance parent DEE-1227. Based on frozen PR762 a9e147f7982fbcceca030fc4079719a06d20d850 in an isolated detached worktree; no changes to PR762, new PR, merge or production authority. User requested all connected accounts on the main screen and supplied its current screenshot on 5 October. Evidence: local audit oct05-admin-overview-scope-gap.json.

## Problem and scope

The existing /admin Overview calls canonical spot valuation while labelling it total capital. PR762 adds V5 account detail but intentionally does not change Overview totals. Complete this display slice without changing canonical financial history, billing, trading or database readers.

1. Label existing financial cards as Spot, including spot result. Preserve their values, quotes, freshness and scope. No combined spot-plus-futures total is introduced.
2. Mount the existing authorized connected-account observation component on /admin, using a bounded overview variant. Reuse its exact directory → current binding → same-binding persisted snapshot path. No HTX requests, new endpoint or database connection.
3. Show separate Futures cards in native HTX USD: equity, available margin and unrealized result. Label these as current observations rather than selected-period profit or USDT. Show all accounts in the selected organization/account scope with Spot and Futures side by side and links to existing details.
4. Overview scope changes unmount/reset the observation component; stale responses cannot repopulate a previous scope. Invalid scope or paper/history mode must not fetch live observations. Currency/period changes retain native USD labels and the current-observation explanation.

## Exact futures summary contract

Pure function input: authorized directory rows with organizationId, credentialId, exchangeAccountId, htxUid, observation status and FuturesBalanceSummary; finite nowMs; directoryCurrent boolean. Only ready rows with a V5 projection, complete non-null values, valid non-future readCompletedAtMs younger than existing 600000ms, and a unique nonempty HTX UID may contribute. Duplicate credential/account/UID identities inside the selected scope are excluded rather than selected arbitrarily or counted twice. Only accounts in the selected scope are fetched; this is not a global account-ownership attestation.

Return currency USD, state complete/partial/unavailable/empty, included/total counts, oldest included read time, excluded account IDs/reasons and exact string sums or null. Missing, stale, error, not-configured, invalid precision/time or directory refresh failure never become zero. All unavailable yields null, whereas fully observed zero yields zero. Partial sum is visibly labelled 'Известная часть', never full capital. Unrealized may be signed. Exact decimal arithmetic accepts bounded scientific notation and retains input precision, with explicit bounds and refusal instead of Number rounding. This helper is display-only and cannot feed Risk/billing or canonical financial history.

## UI and lifecycle constraints

- Preserve directory401/403 clearing and generation/abort guards. A changed directory updatedAt must clear retained observations pending exact reread. Failed directory refresh disqualifies the aggregate even if prior rows remain visibly marked as previously received.
- New main-page variant respects scope without relying on hidden Org controls. Existing standalone connected-account list remains compatible.
- Existing 60s observation-list polling and 1s freshness rendering remain; no additional per-account request path beyond the shared component. No new background service.
- Preserve WAIA tokens, Russian labels, responsive cards/table, keyboard links, no trade controls.

## Acceptance

Targeted pure tests: exact decimal/scientific/negative/zero, mixed complete/missing, all missing, stale/future times, duplicate UID/account/credential, invalid values, stale directory. Mounted component tests: 3 accounts, scope change during pending request, no live fetch in paper/history/invalid scope, directory revocation, native currency independent of console filter. Existing connected-account and overview tests must pass. Fresh build plus targeted mounted Chromium main /admin proof with deterministic local API fixtures; no production/browser policy bypass. Typecheck, lint, build and applicable graph/canon checks once final delta is ready. Independent exact-delta review before commit/publication decision. No full local unit or parent CI rerun.

Main/PR762 production gates remain separate. Local success is not current-key/HTX/cadence/ingress/production acceptance. This slice does not claim confirmed stops, net daily PnL, registration completeness, all currencies/futures families, research qualification or autonomous trading.
