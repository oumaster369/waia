---
integrationIssue: DEE-1159
integrationTitle: "AI-TRADER: seal the private modeled stage kernel call"
parentIssue: DEE-1152
branch: cursor/dee-1159-modeled-stage-kernel-0af0
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation, no-production-0229]
state:
  status: in-progress
  completedWorkPackages: []
  remainingWorkPackages: [validation-walk-forward-blind]
  nextAction: "Independent review and exact-head CI. Do not treat this slice as scientific qualification or as DEE-1159 Done."
provenance:
  createdFrom: "2026-10-02 night continuation after DEE-1200 kernel extraction on main e4123437"
  supersedes: null
---

# DEE-1159 — sealed modeled stage kernel call

## Problem

DEE-1200 already moved the DEVELOPMENT signal → shared sizing → D20 admission → D5 mock order/fill → scoped accounting loop into `lib/trader/research/research-modeled-stage-kernel-v1.ts`. The internal function still accepted a loose bag: transaction, source, request, policy, and model. A later shared stage owner needs one frozen descriptor, the already verified payload, and the supplied owned executor, with no path for untrusted bars, a scorer, a callback, a stage label, a receipt, or an order repository.

## This slice

Keep the existing loop body and the existing public DEVELOPMENT diagnostic. Both the V1 diagnostic and the issued V2 diagnostic seal a descriptor from the attempt, trial, resolved policy, and model they already checked, then pass that descriptor with their verified payload and the same transaction executor.

The kernel refuses any other own key before it touches the executor. The descriptor can be minted only by `sealOwnedResearchModeledStageDescriptorV1`. Absolute sealed `sourceBarIndex` and the local stage index stay separate through `assertResearchModeledStageCycleAlignmentV1`, including a nonzero training start.

## Explicitly unchanged

- Public diagnostic input remains organization, attempt, trial, and bounded read limits.
- Trace authority stays `TRAINING_ENGINEERING_TRACE_ONLY`.
- `scientificQualified` stays false. `capitalEligible` stays false.
- Source and PIT qualification stay not established. Guardian qualification stays `UNQUALIFIED`.
- No validation, walk-forward, or blind payload is added.
- No live order, venue executor, Risk allowance, production migration 0229, or deferred 0230.
- No qualification threshold or NOT_QUALIFIED retune.
- DEE-1159 and parent DEE-1152 stay open.

## Acceptance

- Forbidden kernel keys refuse before any executor method runs.
- An unsealed descriptor and a descriptor/payload identity mismatch refuse.
- A nonzero source offset keeps local index and absolute `sourceBarIndex` distinct, and a broken pair still refuses `CYCLE_INDEX_MISMATCH`.
- The sealed policy object used by the kernel keeps `scientificQualified: false`.
- Existing DEVELOPMENT diagnostic behavior is otherwise unchanged. Full RED/GREEN ledger cases remain the isolated PostgreSQL diagnostic suite; this environment records whether that suite ran.
