---
integrationIssue: DEE-945
integrationTitle: "Remove whole-corpus JSON string limit with exact digest parity"
branch: dee-945-bounded-corpus-json
riskTier: T1
prPolicy: one-integration-pr
executionSurfaces: [local, github-actions]
requiredValidation: [lint, typecheck, unit, build]
approvalGates: [plan-approved, integration-ready, human-merge, human-production]
includedIssues: []
state:
  status: integration-ready
  currentWorkPackage: WP-3
  completedWorkPackages: [WP-1, WP-2]
  remainingWorkPackages: [WP-3]
  prNumber: null
  prUrl: null
  lastValidatedGitSha: null
  lastValidationAt: null
  blockedReason: null
  nextAction: "Open the scoped PR and verify exact-head CI; preserve merge and production gates"
provenance:
  createdFrom: chat
  gapRegistry: null
  supersedes: null
---

## Scope and authority

User requested fixing proven historical launch defects and independent parallel
audit. DEE-945 is the bounded pure-code correction of the BF proposal failure.
Base main: `4a98f3acf68d498bbb75565a1bace685fefb8c1c`, including BF and the
already-merged AI-TWIN changes. Do not modify deployed BF or user WIP.

WP-1: replace whole-corpus canonical comparison with per-anchor comparison, and
hash the exact existing canonical envelope incrementally. Preserve validation,
canonical bytes, corpus, order, all K/M/scientific parameters and Human gates.

WP-2: frozen legacy oracle parity, malformed/Unicode/numeric/order regressions,
oversized input above V8 string limit, and targeted contract/bootstrap tests.
The large test is a serialization-capacity proof, not a historical model test.

WP-3: independent audit and review, lint/typecheck/build, one integration-ready PR.
Record other discovered blockers separately; do not claim this small correction
resolves all production readiness. No merge, deployment, migration, account,
credential, capital or blind-holdout authority is granted by this plan.

## Acceptance

- Canonical equality and SHA-256 bytes match the frozen legacy oracle.
- Actual input above V8 MAX_STRING_LENGTH reproduces the legacy failure and
  completes through bounded serialization without dropping corpus elements.
- Existing negative validation and targeted contract/bootstrap tests pass.
- Lint, typecheck, build, canonical plan validation and exact-head CI pass.
- Scoped independent review has no P1/P2 findings; broader readiness blockers
  remain explicitly open and no deployment is implied.

## Evidence

Production BF proposal failed at 13:33:12 UTC on 2026-09-06 with
`RangeError: Invalid string length`, stack at canonicalCorpus comparison. Adjacent
corpus digest also called whole-object JSON.stringify. Root failure retained in
private server log; no retry. Local validation below; exact-head CI pending.

## Local validation, 2026-09-06

- Serialization and contract: 14/14 tests passed. The capacity regression exceeds
  `node:buffer.constants.MAX_STRING_LENGTH`, reproduces legacy `RangeError`, and
  proves incremental digest parity plus equality without one corpus-sized string.
- Production bootstrap/preflight unit suites: 19/19 tests passed. These are local
  tests, not the full production dataset or database qualification.
- Typecheck passed; lint passed with zero errors and 308 pre-existing warnings.
- Independent scoped reviewer reran the 14 tests and found P1=0/P2=0 in the fix.
- Production build passed (24/24 static pages); local loopback permission was
  required after the sandbox refused a port bind. Governance regressions and
  rendered-body preflight passed. Exact-head PR CI remains pending.

## Independent adjacent-path audit — NOT resolved by this patch

The user requested broader independent review before another production attempt.
Three reviewers examined capacity/scientific qualification, launch lifecycle, and
Admin/tenant observation. This is targeted launch-path coverage, not proof of
every repository function or of scientific profitability.

1. **DEE-946, P1:** first Forecast persists runtime input and authorized outcome
   containing full package/corpus/replica pools. Whole JSON serialization at
   `forecast-v2-persistence-service.ts:545,548,1145,1217` is still a capacity
   blocker. A bounded durable representation requires a coherent versioned
   persistence/replay/load/idempotency contract, not dropping evidence.
2. **DEE-947, P1:** validation bootstrap restart bound uses `n`, but frozen
   DEE-518 sections 2.4.0/2.6.1 require `L`. Independent known-answer mismatch
   reproduced for n=8, L=2. Correcting this changes scientific results and
   requires explicit qualification/version handling; do not reuse affected PASS.
3. **DEE-948:** supervisor child drops configured heap capacity (measured
   24,624 MiB versus 4,144 MiB); bootstrap cleanup can mask primary errors;
   proposal accepts offsets bootstrap cannot execute. Current 525600 is valid.
4. **DEE-949, P2:** denied Admin auth runtime is not disposed; established SSE
   does not revalidate revoked access. Observer suite passed 25 tests, which do
   not cover those negatives. Actual simultaneous production parity is unproven.
5. **DEE-950:** full predictive qualification processes approximately 525k
   anchors per surface and B=10,000 resamples across five baselines. Bounded
   local throughput measurements are not server estimates. No deadline claim
   or reduction of scientific scope follows from the 35-cycle requested demo.

Technical proposal sealing itself stores compact receipts, not the full corpus.
The reserved PostgreSQL session is not proven to rotate at `max_lifetime` while
reserved. These hypotheses were checked and must not be reported as defects.

Merge and deployment remain gated. This patch alone does not make the historical
test ready, and historical readiness does not establish live account readiness.
