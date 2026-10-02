---
integrationIssue: DEE-1225
integrationTitle: "AI-TRADER: show read-only HTX futures positions in Admin and cabinet"
branch: dee-1225-futures-positions
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [focused-unit-tests, tenant-isolation, native-postgres, lint, typecheck, build, e2e, canonical-docs, independent-review, exact-head-required-checks]
approvalGates: [user-authorized-read-only-scope, production-0229-prohibited]
state:
  status: in-progress
  completedWorkPackages: []
  remainingWorkPackages: [position-reader, projection-and-display, validation-and-review]
  nextAction: "Implement the fixed read-only position surface under existing account admission and collection budgets."
provenance:
  authoritativeBase: a5597a548116b31dbdf61a21c8582c2b5dbdfb60
  createdFrom: "Direct user futures visibility request and DEE1225 issue contract, 2026-10-02"
  supersedes: null
---

# DEE-1225 — HTX futures positions

## Authorized scope

The user requires futures balances and trades in Admin and cabinet. DEE1153
implemented account balances only. This bounded follow-on adds actual open
positions to the existing shared account detail; executed-fill history remains
separate unfinished work under DEE1149. It does not create trading authority.
The operator does not enter a technical organization identifier. Internal exact
tenant, current key/revision and explicitly enrolled family checks remain.

## Implementation

Use only fixed signed position-info POSTs on api.hbdm.com:
USDT isolated /linear-swap-api/v1/swap_position_info;
USDT cross /linear-swap-api/v1/swap_cross_position_info;
coin perpetual /swap-api/v1/swap_position_info;
coin delivery /api/v1/contract_position_info. Verify request/response shapes
against the official HTX documentation before parsing them.

Extend the current transport, reader, observation types/validation/service and
shared derivatives-account-section. Preserve bounded exact-decimal parsing,
fresh pre/post key admission, response byte/depth/row caps, serial reads and
abort ownership. Balance and position reads share the existing bounded family
read interval; no silent widening of the collection lease. No arbitrary URL or
body, new database schema/roles, order operation, credential copy or enrollment.

Store positions through the existing tenant/revision-bound observation JSON.
Old v1/v2 observations remain readable with positions explicitly unobserved;
never reseal or rewrite stored history. Give positions their own status, safe
error and observed interval independently of balance success. Cross collateral
is shown once, never summed from position rows or across currencies.

## Acceptance

1. All four official position families have strict parsers and fixtures for
   contract identity, long/short, quantity, available/frozen, prices, margin,
   unrealized PnL/currency and leverage; absent fields stay unavailable, not zero.
   Reject ambiguous identities, malformed decimals and duplicate rows.
2. Existing credential/family admission and post-read revocation invalidate the
   whole affected result; no HTTP request for unenrolled families. Bounds and
   cancellation remain enforced for every network operation.
3. Backward-compatible persistence/projection roundtrip and tenant denial are
   covered; error, unobserved, empty-success, partial and stale are distinct.
4. Shared Admin/cabinet UI shows positions clearly separated from account
   balances and executed trades. Both browser surfaces have focused coverage.
5. Focused units/native roundtrip, lint/typecheck/build, canon/affected graphs,
   independent review and all applicable exact-head CI before merge. Full
   units run on PR CI, not a redundant local full run.

## Boundaries and rollback

Production0229 remains prohibited and0230 deferred. No production deployment,
collection activation, real credentials or live venue calls in implementation.
No order placement/cancellation, financial/scientific/holdout change. Source
completion does not imply real account collection or trader readiness.
Revert PR is rollback; preserve old observations and account/key rows.

## Primary references

- https://huobiapi.github.io/docs/usdt_swap/v1/en/
- https://huobiapi.github.io/docs/coin_margined_swap/v1/en/
- https://huobiapi.github.io/docs/dm/v1/en/
