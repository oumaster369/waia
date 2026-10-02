---
integrationIssue: DEE-1208
integrationTitle: "AI-TRADER: reject future outcomes at research evidence and memory cutoffs"
parentIssue: DEE-1152
branch: dee-1208-research-evidence-cutoff
riskTier: T2
prPolicy: one-integration-pr
executionSurfaces: [local, github-pr-ci]
requiredValidation: [lint, typecheck, build, focused-unit, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-technical-fix, independent-review, required-ci]
state:
  status: in-progress
  prNumber: null
  nextAction: "Independent review and required PR CI remain; no database or scientific qualification work is in scope."
provenance:
  createdFrom: "Bounded DEE-1208 issue contract and current-main source audit"
  gapRegistry: null
  supersedes: null
---

# DEE-1208 — research evidence cutoff integrity

## Problem and scope

The current package builder validates that evidence cutoffs and outcome timestamps are individually well-formed, but does not enforce the causal relation between them. Memory append also accepts deserialized package/prior-memory objects without rechecking their full temporal and content integrity against the new cutoff. An outcome observed after the declared as-of time can therefore enter an earlier package or memory snapshot through these exported pure APIs.

Enforce the existing invariant `observedAtUtc <= evidenceCutoffUtc` (inclusive equality) at both package construction and memory ingestion. Validate timestamps before comparison, and fail closed with an actionable `StrategyEvolutionResearchError` on malformed/future inputs. A valid prior memory must not be silently rewound past records after the incoming package cutoff. Rejection must not mutate the supplied package or prior memory. Preserve content digests, canonical bytes, ordering, duplicate/conflict semantics and every valid polarity.

This is an input consistency guard. Content hashes prove consistency of bytes, not trusted source issuance or point-in-time source provenance. No qualification authority is added.

## Work packages

1. **Baseline counterexamples:** preserve a canonical valid mixed-polarity package fixture and its digest/bytes; demonstrate on unchanged main that each future polarity is accepted and that a resealed future package or prior memory can be appended under an earlier cutoff.
2. **Minimal implementation:** add a shared package integrity/cutoff assertion; apply it in the package builder and at memory ingestion to validate the package and prior memory before merging. Use existing canonical content-digest guards where available. Copy accepted records into newly frozen memory records so returned memory does not alias mutable deserialized input. Do not filter invalid/future records or rewrite them.
3. **Readiness:** add exact-cutoff, prior-cutoff, all-polarity, malformed timestamp, serialized/resealed input, invalid prior-memory, envelope/digest-refusal and nonmutation regressions. Pin exact original-main canonical bytes/digests for both a mixed-polarity package and its memory representation. Run related evolution/discovery tests, lint, typecheck, build, canonical and affected consumer graphs. Preserve RED artifacts and independent review; exact-head CI remains a merge gate.

## Acceptance

- Future PROFIT, LOSS, FLAT, INCONCLUSIVE and INVALIDATED outcomes all refuse; no outcome is filtered.
- A record exactly at cutoff is accepted. A valid earlier mixed-polarity package has unchanged canonical serialization/content digest from the captured baseline and retains its losses.
- A valid earlier appended memory also retains its original canonical serialization/content digest; returned records are immutable snapshots that are not aliases of deserialized package or prior-memory records.
- Direct `appendResearchMemoryV2` and `resumeResearchMemoryV2` cannot bypass the guard with deserialized/resealed future packages, future records in prior memory, or a rewind cutoff.
- Invalid timestamps refuse before lexical/NaN-style comparison can bypass the cutoff. Rejection leaves inputs untouched; valid ordinary append, identical dedup and conflicting-ID refusal remain unchanged.

## Do not

No issuer/source qualification, dataset/PIT authority, market acquisition, strategy generation, financial/cost/threshold/entry-rule changes, observation-helper or volatility changes, schema/migration, production access/deployment, C3/holdout access, live authority or venue interaction. Do not retrofit existing invalid evidence; refuse it.

## Files and rollback

Only `lib/trader/research-v2/closed-trade-outcome-evidence-v2.ts`, `lib/trader/research-v2/research-memory-v2.ts`, focused tests and this plan. Pure in-memory invariant; no native DB proof is applicable. Revert this bounded guard and retain the baseline counterexample evidence if the independent review rejects its compatibility semantics.
