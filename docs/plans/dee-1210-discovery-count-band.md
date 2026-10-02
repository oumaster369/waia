---
integrationIssue: DEE-1210
integrationTitle: "Stop presenting discovery trade-reference counts as volatility"
batchMode: single-issue
branch: dee-1210-discovery-count-band
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, lint, typecheck, build, validate-canon, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-production-data, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1-plan]
  remainingWorkPackages: [WP-2-v2-contract, WP-3-regime-wording, WP-4-review-and-exact-head-ci]
  nextAction: "Land the V2 count-band contract and regime-label question wording, then obtain independent review and exact-head CI before merge."
provenance:
  createdFrom: "DEE-1210 Linear contract, admitted 2026-10-02 regime-wording follow-up, and current main 520672258014ca4600b2343eef530a65dc38d769"
  supersedes: null
---

# DEE-1210 — trade-reference count bands, not volatility

Prepared head `1849b522d28735f2f8d11ab41b06c5f7e6fe0076` was not on `origin` and the handoff bundle was not mounted in this workspace. This plan records the contract that will be applied onto current `main` (`520672258014ca4600b2343eef530a65dc38d769`, PR750). It does not claim byte identity with that prepared head.

## Goal and scope

Newly generated descriptive structure clusters must not present a trade-reference count as measured volatility. Keep the existing descriptive cutpoints (`<=1`, `<=5`, `>5`) and the existing grouping counts. Emit an explicit V2 cluster whose metric is the trade-reference count band, whose signature key and content digest are versioned, and whose measured volatility is unavailable.

New question generation accepts only a validated V2 cluster. It refuses legacy V1, a forged metric, a count/band pair the grouping counts cannot produce, a wrong version, or a wrong digest. Question text names the count band and does not imply a measured volatility. The rejection-context question uses the validated cluster's actual regime label.

Immutable V1 artifact types, canonical bytes, and digests stay readable and are not rewritten, reinterpreted, or backfilled. The registry append path accepts a new V2 payload only, and still applies the existing organization scope. No column migration. The opaque JSON payload remains the stored body.

## Non-goals

No new volatility threshold or feature, no policy or financial criterion, no scientific qualification, expected edge, fit, admission, or promote operation. No default-on runtime, actual market data, database migration, production release, holdout or C3 access, or live trading. ADR-0020 and the no-reinforcement policy stay as they are. DEE-1152 and DEE-646 stay open. Hypothesis-studio mapping stays untouched. 0230 stays deferred. No Org0 UI.

## Work packages

- **WP-1 — plan:** freeze this contract before source changes.
- **WP-2 — V2 contract:** emit V2 from the normal clusterer, preserve V1 bytes and digests, validate count bands, and append only validated V2 at the registry boundary.
- **WP-3 — regime wording:** rejection-context questions use the validated regime label, with synthetic counterexamples for a non-bear label and for bear and stress labels, including canonical question digests.
- **WP-4 — review and CI:** targeted tests, lint, typecheck, build, and canonical validation locally; independent review and exact-head CI before merge. Do not merge from this branch without that review.

## Acceptance

1. New V2 signatures name the trade-reference count metric and do not carry a fabricated volatility bucket. New question text says count and does not imply measured volatility.
2. Counts 0, 1, 2, 5, and 6 still exercise the original cutpoints. Membership, observation counts, and summed trade-reference counts follow the existing grouping, including a zero-trade observation that has a regime.
3. A versioned V2 key and digest do not collide with a relabeled V1 signature. The frozen V1 fixture bytes and digest stay unchanged. Legacy V1 is not accepted as new V2 input.
4. Malformed or forged metric, count/band inconsistency, and wrong version or digest are rejected before a new question or appendable artifact is produced. Grouping stays deterministic. PnL is not a fitness input.
5. Focused tests cover the contract. Independent review and exact-head CI on current `main` remain required before merge.

## Validation limits

Synthetic observations only. This corrects a dormant descriptive label. It does not enable trading, paper-loop execution, production writes, or a deploy with `PAPER_LOOP_ENABLED=1`.
