---
integrationIssue: DEE-1207
integrationTitle: "AI-TRADER: bind actual DEVELOPMENT feature windows before qualified use"
parentIssue: DEE-1159
branch: dee-1207-research-input-use
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [targeted-unit, native-postgres, lint, typecheck, build, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-production-operation, no-scientific-qualification]
state:
  status: in-progress
  completedWorkPackages: [WP-1]
  remainingWorkPackages: [WP-2, WP-3]
  nextAction: "Complete final native regression proof, then integrate after DEE-1203 with independent review and exact-head CI."
provenance:
  createdFrom: "October 2 root/independent source audit; explicit user autonomous engineering authorization"
  supersedes: null
---

# DEE-1207 — actual DEVELOPMENT input use

Frozen before source implementation on prepared DEE-1203 head
`38eb7aa6e59e8329bde720e82260e28ce7f653ac`. DEE-1203 must merge first;
only this child's diff will be rebased onto its actual main result.
Root owns semantics/source; independent test author and adversarial reviewer.

## Scope and compatibility decision

The diagnostic currently queries training payload before resolving the immutable
policy, and accepts a sidecar declaration although this executable reads OHLCV
only. Resolve policy from the already loaded preregistration and reject a non-null
sidecar before any historical-authority payload query. Preserve observed release
preflight, exact registered source checks, and all financial/strategy behavior.

Record each actual evaluator invocation in the private kernel, including NONE:
ordered index/source-cycle identity, decision cutoff, first/last provided bar,
window count, digest of the exact ordered provided bars, trial-parameter digest
and returned signal. The existing bounded trailing window remains identical.
Record what was supplied to the evaluator, not a claim of which individual
property its implementation read. The later bar cannot enter an earlier window.

Bind these invocation receipts to the checked source run/class/dataset authority,
organization/spec/attempt/trial, partition endpoints/count/content digest,
observed executable identity and exact policy. Persist the resulting versioned
`DEVELOPMENT_INPUT_USE_INTEGRITY_ONLY` receipt inside the existing atomic trace.
No new database table, source issuer, evaluator callback or public scorer input.

New trace schema is `waia.research.training-diagnostic.v2`; retain the old V1
constant as historical schema identity. Current exact retry requires V2 and a
verified input-use binding, as well as all existing scope, release, ledger,
accounting and whole-trace digest checks. A stored V1 trace is preserved verbatim
and returns an explicit legacy-trace refusal before payload access on this executable path; it is never
rescored/overwritten or silently relabeled as V2. A new authorized diagnostic uses
a new immutable attempt. These traces have never conferred qualification.

Retry verifies the input receipt against freshly checked source metadata and
ordered supplied windows, without rerunning order effects. Unknown/missing
schema, invocation counts, parameters, bounds or content refuse. The receipt's
self-digest alone is insufficient; compare it to the exact current checked input.
Do not weaken historical row or ledger divergence checks.

Implementation clarification from independent review: source binding also hashes
the complete checked execution cycles, because their volume/cycle metadata can
affect fills even when OHLCV bars are unchanged. The legacy preflight reads only
the committed trace metadata; current V2 is re-read under the stage lock. These
checks add no source or scientific authority.

## WP-1 — preflight and connected trace

1. Move immutable policy resolution before the payload reader; enforce no sidecar
   on the existing policy/closed diagnostic path. Retain unsupported fused-context
   and intelligence-profile refusal.
2. Capture invocation receipts immediately around the actual evaluator call;
   retain the NONE call before its early continue. Reuse the exact same window
   construction for invocation capture and retry verification, through a private
   kernel-owned deterministic helper if needed. No caller-provided receipt.
3. Bind/persist V2 input-use evidence and verify it on exact retry. Preserve
   sourceQualification NOT_ESTABLISHED, scientificQualified false,
   capitalEligible false and existing Guardian limitations. Also pin these fields
   in the current committed-trace verifier.

## WP-2 — regression and native proof

Use only synthetic local data and the actual existing issuer/reader/diagnostic
harness. Invalid policy and sidecar must fail before any historical authority
payload query and produce zero stage/trace writes. Positive traces bind every
invocation; altering a later bar cannot change earlier provided-window receipts.
Changing an earlier consumed bar/parameter/source or resealing a false receipt
must refuse current retry. Exact retry changes no ledger effects. V1 trace remains
unchanged and refuses as legacy. Supported input economics, ordering and declared
risk/portfolio rules remain unchanged; existing behavioral tests must still pass.

A database callback mock is not native evidence. A query observer may record the
real SQL ordering. Existing eight-file proof is preserved; extend its source
manifest/path triggers if new actual proof dependencies require it. Do not weaken
required suites or accept skips. No production journal change or 0229/0230 use.

## WP-3 — integration

Targeted units, isolated PostgreSQL, scoped lint/type/build/canon/consumer graphs,
independent whole-diff review, actual-main rebase and all applicable exact-head CI.
Avoid duplicate full local unit suites. Code rollback is a revert PR; preserve
versioned recorded evidence. Update Linear and checkpoint with exact proof limits.

## Boundaries

This proves stored-input integrity and computational prefix use only. It does not
prove historical publication time, unrevised vendor bars, universe membership,
PIT origin or an independent source authority. Requested PIT/known-at fields
remain declarations. Do not access real market/C3/validation/WF/blind payloads,
change financial or entry semantics, promote a strategy, deploy to production,
apply migrations, or activate trading. Whole-family selection, full qualified
stages and the scientific qualification remain DEE-1159/1152 work.
