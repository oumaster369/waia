---
integrationIssue: DEE-1209
integrationTitle: "Preserve as-of context in descriptive discovery observations"
branch: dee-1209-discovery-asof-context
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [targeted-unit, lint, typecheck, build, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-production-data, no-live-activation]
state:
  status: in-progress
  completedWorkPackages: [WP-1-plan-and-baseline, WP-2-causal-validation-and-regression, WP-3-readiness]
  remainingWorkPackages: [WP-4-review-and-exact-head-ci]
  nextAction: "Obtain independent review and satisfy required exact-head CI before merge."
provenance:
  createdFrom: "DEE-1209 Linear contract and Oct 2 source review"
  supersedes: null
---

# DEE-1209 — as-of context for descriptive discovery observations

## Goal and scope

Keep the current descriptive regime classifier and its 20-bar window. For each
closed trade, derive that regime from the last 20 bars available at that trade's
time, not the last 20 positions in the entire supplied observation series. A
later, still-in-window suffix must not change an earlier trade reference.

Validate the declared observation window and consistency of its bars and
trades before computing the observation digest: valid ordered window bounds,
bar and trade timestamps within those bounds, common symbol and interval for
bars, trade symbol matching the declared observation symbol, and strictly
ordered non-overlapping bars. A bar closing exactly at trade time is available
for that trade. A malformed, mixed, duplicate, unordered or out-of-window item
refuses synthesis rather than producing a misleading digest. Preserve every
trade reference, including losses; with fewer than 20 available bars, retain a
null regime. A custom resolver receives only the causal bar prefix for its
trade; it does not receive later bars.

The observation-level regime is derived only from the validated declared bar
window. This remains descriptive data generation, not candidate ranking,
profit fitness, qualification, or runtime discovery wiring.

## Non-goals

No classifier/threshold/20-bar rule changes, volatility-bucket redesign,
strategy or source/PIT issuer, operational discovery wiring, schema/migration,
financial or scientific policy, real dataset/holdout/C3 access, production
action, or trading activation. DEE-646 and DEE-1152 remain open; this change is
not empirical research completion.

## Work packages

- **WP-1 — baseline:** preserve the valid-input baseline and capture a failing
  original-source regression where a later suffix changes the earlier trade's
  observation label.
- **WP-2 — bounded fix:** validate declared time/scope consistency and form a
  causal prefix per trade; keep the current classifier and 20-bar threshold.
  Prove exact-time close inclusion, future exclusion, under-20 null behavior,
  resolver prefix isolation, invalid-input refusal before resolver invocation,
  trade preservation, and input immutability.
- **WP-3 — readiness:** run targeted observation/consumer tests, lint,
  typecheck, build, canonical validation and affected consumer graphs; preserve
  source/evidence receipts.
- **WP-4 — review and CI:** obtain independent review and pass the required
  exact-head CI before merge.

## Acceptance

1. The original-source regression fails because appending later bars changes a
   historical trade label; after the fix that label remains unchanged.
2. A close exactly at trade time is accepted; future bars are excluded;
   insufficient causal history yields a null regime without dropping the trade.
3. Reversed/malformed bounds, malformed or out-of-window timestamps,
   mixed-symbol/interval, duplicate/unordered/overlapping bars and foreign or
   future trades refuse before a custom resolver runs.
4. Current observation-level regime uses only the validated declared window;
   caller inputs remain unchanged and the existing classifier/20-bar behavior
   is preserved.
5. Targeted tests, lint/typecheck/build/canon and affected graph checks pass;
   independent review and all exact-head CI checks remain required.

## Current evidence

The original-source regressions and valid-input baseline are preserved in the
Oct 2 audit evidence directory. The focused synthetic unit file passes 20/20;
file-scoped lint, repository lint, typecheck, production build, canonical
validation, and both consumer-graph validators passed on the working tree.
Full exact-head CI and independent review remain outstanding.

## Validation limits

Use synthetic bars and trades only. The helper has no current non-test caller,
so this addresses a latent deterministic correctness defect and does not claim
production impact, empirical discovery completion, or any scientific or
financial acceptance.
