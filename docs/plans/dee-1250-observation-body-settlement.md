---
integrationIssue: DEE-1250
integrationTitle: "Restore observation after terminal response-body errors"
branch: dee-1250-observation-body-settlement
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local]
requiredValidation: [lint, typecheck, focused-unit, build]
approvalGates: [independent-review, exact-head-ci, admitted-nontrading-release]
includedIssues: []
state:
  status: in-progress
  currentWorkPackage: WP-1
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Problem and scope

An already errored native response stream rejects redundant cancellation with its stored error. The observation transports currently classify every cancellation rejection as uncertain cleanup. The configured runtime then retains the affected lease owner and permanently refuses subsequent account openings. A four-account isolated reproduction matches the observed stale-data pattern on both the deployed collector and the prepared financial-history source. Existing sanitized production logs do not establish the initiating error, so the reproduction is not a claim that the exact original network failure was observed.

The user authorized autonomous completion and repair of account connection, freshness and financial history while prohibiting trades and interference with the separate trader. This package restores the existing read-only recurrence contract; it introduces no new provider endpoint, account authority, schema, schedule, concurrency, or product semantics. Production recovery and release require separately bound operational evidence.

## Implementation

Use a narrowly scoped owned-response-body helper across Spot/admission, legacy derivatives and V5 transports. A terminal stream error must be established before cancellation while the same reader remains exclusively owned. A real cancellation failure on a previously readable stream must still reject settlement. Do not clear the global cleanup barrier or discard an unsettled owner. Continue to await every tracked fetch, action, read and cancellation promise, including late responses after timeout.

Update the three existing observation-only consumer content pins and the exact GET transport import allowlist for the shared settlement helper. Preserve all discovery roots, file counts, path digests, admission rules and connector reference checks.

Preserve generic sanitized read failures, current-key identity and permission checks, pre-decrypt guards, bounded GETs, deadlines, account binding, response-size limits, TLS and lease ownership until actual settlement. No database or provider I/O in tests.

## Acceptance

1. Native stream terminal-error cases before and during reading, EOF, invalid response and regular HTTP errors.
2. A rejecting or hanging underlying cancel remains failed or pending; unresolved/late fetch and read keep overlap and lease fences.
3. Four-account configured-runtime regression: one failed admission does not permanently block unrelated accounts; a later healthy cycle can commit, and shutdown settles.
4. Focused transport/configured-runtime tests, lint, typecheck, normal build and exact-head CI. Full unit suite runs only in CI.
5. Independent source review must find no unresolved cleanup/ownership bypass. Actual recovery, all-current-account natural recurrence and authenticated English cabinet freshness remain separate from source readiness.

## Remaining product work

This package does not complete persisted financial-history rollout, full-period PnL/valuation, external journal delivery, billing, protection or research qualification. Their runtime and semantic acceptance remain open. The new-account form and cabinet must be verified without sending trade requests or inventing data from missing observations.
