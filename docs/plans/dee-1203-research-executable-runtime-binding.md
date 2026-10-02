---
integrationIssue: DEE-1203
integrationTitle: "Bind registered research diagnostics to the observed deployment release"
parentIssue: DEE-1159
branch: dee-1203-research-runtime-binding
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, isolated-postgres, github-pr-ci]
requiredValidation: [lint, typecheck, build, targeted-unit, native-postgres, validate-canon, consumer-graphs, independent-review, required-ci]
approvalGates: [user-authorized-engineering, independent-review, required-ci, no-live-activation]
state:
  status: in-progress
  prNumber: null
  nextAction: "Obtain independent review and exact-head CI on the actual-main rebase; retain the 94-assertion PostgreSQL result as historical source-bound evidence."
provenance:
  createdFrom: "Bounded extraction from the pre-implementation DEE-1159 observed executable binding plan"
  supersedes: null
---

# DEE-1203 — observed executable release binding

## Problem and implementation boundary

The registered DEVELOPMENT diagnostic retains a requested executable digest but
does not compare it with the release actually executing the trial. Resolve a
closed versioned descriptor from the deployment owner's existing
`WAIA_RELEASE_SHA` / `VERCEL_GIT_COMMIT_SHA` convention. Accept only a full Git
SHA; absent, malformed or conflicting values refuse. Only an absent WAIA value
falls back to Vercel; an explicit empty WAIA value is invalid.

Bind the observed release, fixed executable ID, feature semantics and replay
semantics into a digest. This is a trusted deployment assertion of the complete
release, not independent source-file measurement or a new signature authority.
Compare the preregistered expected executable digest after reading immutable
attempt/experiment metadata and before selecting any market payload or writing
stage effects. The public runner accepts no observed digest or environment
object from its caller. Retain the closed DEVELOPMENT payload loader and check
that its identity still matches the metadata preflight.

Persist the observed descriptor in the append-only diagnostic trace. Exact
retry must match that descriptor, including the release. A legacy trace without
it cannot be adopted as current executable evidence. Keep the trace explicitly
non-qualifying: no source/PIT qualification, qualified Guardian, validation,
walk-forward, blind access, candidate admission, or capital permission follows.
Parent DEE-1159 remains open for those separate acceptance conditions.

## Acceptance and evidence

- Unit cases cover absent/empty/malformed/conflicting values, case normalization,
  deterministic identity, changed releases and immutable returned descriptors.
- Real isolated PostgreSQL query observation proves mismatches read only
  attempt/experiment metadata and perform no payload or stage writes. Missing
  or conflicting release values cause no database query.
- The correct preregistered identity executes and produces one exact retry;
  a changed release after commit refuses without another payload read or ledger
  write. A structurally valid legacy trace missing only the new descriptor is
  refused.
- The existing eight-suite synthetic PostgreSQL CI job executes the modified
  native file and checks all files, zero failures/skips/empty reports and stable
  source hashes. Local readiness and independent review precede exact-head CI.

No real market/holdout/C3 payload, production database migration, financial rule
change or live activation is part of this child. The diagnostic draft DDL
remains test-only and is not promoted into the production migration journal.

## Actual-main rebase status — 2026-10-02

DEE-1205/PR735 merged as `07ae1bc3af54027b1acc7e1fc7be9da0ef6641d9`. This child is rebased on that exact main commit at `2f04c956c352fe58fca0e30876ae0025ed57fc43`; the one-commit range-diff is patch-equivalent to the prepared DEE-1203 commit. All seven files from the owned change were byte-identical immediately after the rebase. The earlier 94-assertion PostgreSQL run remains historical and source-bound to its recorded capture; it is not a fresh exact-main native proof. Scoped local readiness passed on this base; independent review and exact-head CI remain required.
