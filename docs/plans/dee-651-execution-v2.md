---
integrationIssue: DEE-651
integrationTitle: "AI-TRADER — Execution V2 authority, fail-unknown effects, and global caller cutover"
branch: dee-651-execution-v2
riskTier: T3
prPolicy: one-integration-pr
executionSurfaces: [local, linear, postgres-ci, github-pr]
executionLabel: backend
requiredValidation: [lint, typecheck, build, unit-targeted, prior-full-suite-inventory, postgres-integration, tenant-isolation, rls, locking-concurrency, consumer-graph, integration-train, canon, pr-governance, authoritative-pr-ci]
approvalGates: [human-step-15-ratified, human-t3-scope-ratified, pre-implementation-admission, integration-ready, independent-adversarial-review, dee-653-exact-head-admission]
includedIssues:
  - id: DEE-667
    role: contracts-and-persistence-substrate
    completionPolicy: manual-after-exact-head-merge
    status: pending
  - id: DEE-668
    role: atomic-authority-effect-bind
    completionPolicy: manual-after-exact-head-merge
    status: pending
  - id: DEE-669
    role: fail-unknown-recovery-report-boundary
    completionPolicy: manual-after-exact-head-merge
    status: pending
  - id: DEE-670
    role: global-legacy-caller-cutover
    completionPolicy: manual-after-exact-head-merge
    status: pending
deferredIssues: []
blockedByActiveWork: []
linearStatusFlow:
  onPlanApproved: In Progress
  onPrOpened: In Review
  onMerge: Done
state:
  status: in-progress
  currentWorkPackage: WP5
  completedWorkPackages: [WP0, WP1, WP2, WP3, WP4]
  remainingWorkPackages: [WP5]
  prNumber: 477
  prUrl: "https://github.com/oumaster369/waia/pull/477"
  lastValidatedGitSha: d3c768d064dfbbd7f86ef4d6b4dad41093850cef
  lastValidationAt: "2026-08-22T12:50:00+03:00"
  blockedReason: null
  nextAction: "Complete affected manifest/canon/governance validation on the rebuilt frozen head, obtain one fresh exact-head adversarial review, then update PR #477 only if base/head remain unchanged."
provenance:
  createdFrom: human-ratified-delegation
  gapRegistry: null
  supersedes: null
humanApproval:
  authorizedAt: "2026-08-21"
  authorizedBaseMain: 8aa3d316d407f2f1ded567e8bb44123657972113
  dependencyPullRequest: 475
  baseHeadPullRequest: 476
  authority: "Explicit Human ratification of Step 15, the four-child Integration Train, the additive four-table PostgreSQL/RLS substrate, and HTX FAIL-UNKNOWN semantics."
  governanceCorrectionAuthorizedAt: "2026-08-21"
  governanceCorrectionAuthority: "Human explicitly authorized rebuilding the unpushed train from authoritative origin/main with unchanged A→B→C→D semantics and only the 11 discovered DEE-670 whole-repository consumer test files added to the admitted surface."
  semanticCorrectionAuthorizedAt: "2026-08-21"
  semanticCorrectionAuthority: "Human explicitly ratified exactly nine additional DEE-670 test surfaces and genuine test-only Execution V2 allowance→policy→plan→attempt sealing with zero legacy simulated submission/fill authority."
  testOnlyCrossIssueAuthorizationAt: "2026-08-21"
  testOnlyCrossIssueAuthorization: "Human explicitly authorized only a TEST_ONLY DEE-634 Decision→Risk→Execution orchestration port and PostgreSQL CI proof for the nine admitted FHV/Control Replay/full-historical/session tests. DEE-634 remains Todo and no production wiring or closure is claimed."
  finalShellFailCloseAuthorizationAt: "2026-08-21"
  finalShellFailCloseAuthorization: "Human explicitly authorized only tests/integration/fhv-public-ceremony-shell.test.ts to assert CONTROL_REPLAY=FAIL with TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED and stop before authorize-full/full-run. Production CLI PostgreSQL wiring remains forbidden."
  adversarialRemediationAuthorizationAt: "2026-08-21"
  adversarialRemediationAuthorization: "Human explicitly authorized remediation of the exact-head P1/P2 findings in existing admitted V2 files plus only lib/trader/connectors/htx/mappers.ts, lib/trader/connectors/htx/htx-exchange-connector.ts, lib/trader/connectors/types.ts, and tests/unit/trader-connector-htx.test.ts. Any fifth new surface is a STOP gate."
  finalLowLevelRemediationAuthorizationAt: "2026-08-22"
  finalLowLevelRemediationAuthorization: "The same Human authorization explicitly covers all remaining review findings: persisted plan/effect notional must be transitively proven against the stored policy and Risk allowance, and the final execution window must use wall-clock time after lock waits. No additional implementation or connector surface is admitted."
  officialScaleV2AuthorityAuthorizationAt: "2026-08-22"
  officialScaleV2AuthorityAuthorization: "Human explicitly admitted only tests/fhv/official-scale/blocking/fhv-official-representative-segment.test.ts, tests/fhv/official-scale/blocking/fhv-official-throughput-probe.test.ts, their shared fhv-official-scale-harness.ts, and .github/workflows/ci.yml limited to PostgreSQL 16 plus TEST_ONLY V2 enablement in exactly those two jobs. Their nonzero historical modeled fill/accounting floors must be preserved through genuine allowance→policy→plan→attempt authority before modeled effect."
---

# DEE-651 — Execution V2 Integration Train

## Goal and authority boundary

Deliver Human-ratified Step 15 as one governed Integration Batch: exact
`RiskAllowanceV2 → ExecutionPolicyBindingV2 → ExecutionPlanV2 → ExecutionAttemptV2 → raw ExecutionReportV2`
authority, durable pre-network effect binding, fail-unknown HTX behavior, and a whole-repository
legacy caller cutover. Execution checks mechanical envelope membership only. It never recomputes
Decision economics, invents post-trade truth, or treats a legacy order state as capital authority.

The verified base is `origin/main@8aa3d316d407f2f1ded567e8bb44123657972113`, which contains the
Human-merged DEE-650 / PR #475 dependency and the file-disjoint DEE-619 / PR #476 squash. DEE-651
has no duplicate branch or PR. DEE-634 remains downstream; DEE-620 is separate and excluded.

This is a T3 batch because it joins capital-authority contracts, one additive Postgres migration,
RLS, transactional row locking, connector effects, and global caller closure. The Human explicitly
pre-authorized the exact architecture and scope. Production SQL/Supabase mutation, live-capital
activation, holdout access, security-policy mutation, destructive operations, raw-storage gate
crossing, and every Execution Server action remain Human-only and out of scope.

## Current database guidance checked

The 2026-08-21 Supabase changelog and current Supabase/PostgreSQL guidance were checked before
implementation. No current breaking change alters this migration. New exposed-schema tables must
enable RLS; this batch uses explicit deny policies and revoked `anon`/`authenticated` privileges.
All authority composition uses one database transaction and row-level locks held until transaction
end. No remote or production database mutation is authorized.

## Exact serialized train

| Wave | Child | Scope | Review bound |
|---|---|---|---|
| 1 | DEE-667 / E651-A | V2 contracts, four-table migration, typed schema, repository, RLS/tenant proof | ~550–750 implementation lines |
| 2 | DEE-668 / E651-B | Atomic allowance→policy→plan→attempt→exact-payload bind before network | ~450–650 implementation lines |
| 3 | DEE-669 / E651-C | Fail-unknown HTX/recovery/raw reports; remove fabricated fill fallback | ~350–550 implementation lines |
| 4 | DEE-670 / E651-D | Paper/live/guardian/replay/harness cutover and static/runtime consumer closure | ~650–950 implementation lines |

The dependency order is A→B→C→D. B and C are strictly serialized. No parallel implementation is
planned. D will be executed as reviewable internal caller-family work packages after A freezes the
API, but remains one Linear child and one integration PR.

The Human-authorized admission correction dated 2026-08-21 adds only the 11 consumer test files
discovered by the pre-freeze whole-repository audit (12 obsolete legacy expectations) to DEE-670's
expected surface. Child inventory, dependency order, runtime semantics, risk tier, exclusions,
single-branch/single-manifest/single-PR boundary, and HTX FAIL-UNKNOWN policy are unchanged.

After the first frozen-head full-suite inventory exposed nine further scientific Control Replay,
official FHV, and capital-trace expectations, the Human ratified one exact semantic correction:
those nine tests are admitted to DEE-670, their legacy simulated submission/fill expectations are
removed, and their non-capital scientific paths must seal genuine
`RiskAllowanceV2 → ExecutionPolicyBindingV2 → ExecutionPlanV2 → ExecutionAttemptV2` authority while
performing zero external effect. This does not authorize a SQLite V2 adapter, production/live
capital, holdout access, an Execution Server, or any HTX retry/lookup assumption.

The Human then explicitly authorized the exact cross-issue TEST_ONLY seam needed to execute that
proof: one injected authority port, one local PostgreSQL test helper, propagation through the
Control Replay ceremony/launch/CLI, and one blocking PostgreSQL CI command for the nine admitted
files. The helper must claim a real RiskAllowanceV2, preserve reservation→pending transfer, commit
the sealed plan/attempt/exact effect, then inject a zero-effect timeout to prove raw
`CONNECTOR_UNCERTAIN → RECONCILIATION_REQUIRED`, deterministic restart, and no blind resend.
Full-historical/session legacy submit paths remain fail-closed; their admitted tests pair that
zero-order/zero-fill result with genuine TEST_ONLY V2 authority evidence. This is not production
Decision→Risk→Execution wiring, and DEE-634 remains Todo.

The final Human-authorized correction admits only
`tests/integration/fhv-public-ceremony-shell.test.ts`. Because its Control Replay runs in a separate
CLI process without the injected TEST_ONLY PostgreSQL authority port, the public ceremony must
assert `CONTROL_REPLAY=FAIL` with `TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED` and stop before
authorize-full/full-run. Production CLI PostgreSQL wiring is explicitly not authorized; all other
surfaces and semantics remain unchanged.

The first fresh frozen-head adversarial review then identified four remaining authority/truth
defects: scale-8 multiplication could truncate a positive notional remainder; the low-level report
repository could accept terminal caller labels without exact bound evidence; cancel observations did
not validate retained fill totals and discarded mismatches; and the HTX mapper permissively inferred
unknown order mechanics. The review positively confirmed that HTX unknown states already remained
FAIL-UNKNOWN with raw observations and no blind resend. The Human explicitly authorized fixing all
review findings in the already admitted V2 files plus exactly four connector surfaces:
`lib/trader/connectors/htx/mappers.ts`,
`lib/trader/connectors/htx/htx-exchange-connector.ts`,
`lib/trader/connectors/types.ts`, and `tests/unit/trader-connector-htx.test.ts`. No fifth new surface,
new retry/lookup assumption, or production boundary is admitted.

A subsequent independent frozen-head review found that the same authorized invariants were not yet
closed at every low-level boundary: exported repository inserts plus the raw dispatcher could be
composed around the atomic bind; the execution window was not rechecked immediately before submit;
the legacy guardian path could synthesize `CANCELLED`; and cancel evidence reads could race the
append. No new file or semantic surface was required. Under the same Human authorization, the final
A→B→C→D remediation locks and validates the persisted allowance ceiling, reconstructs the exact
plan/attempt/order effect before network, rechecks the sealed window, serializes cancel evidence,
stops non-historical legacy cancellation at `CANCEL_REQUESTED`, and extends the static graph to
inventory cancellation callers. HTX remains FAIL-UNKNOWN with no resend or lookup assumption.

The next exact-head review found two final transitive-proof defects inside those same admitted V2
files: a self-consistent low-level plan could understate its actual effect notional because
persistence trusted caller-projected policy fields, and the immediate pre-submit window check used
transaction-start time after waiting for an attempt lock. The Human explicitly authorized all review
remediation under the existing boundary. A final serialized A→B correction now reconstructs full
stored-policy membership and conservative plan/slice effect notional before persistence and restart
dispatch, and reads PostgreSQL wall-clock time only after all effect locks immediately before
`SUBMIT_STARTED`. The real clean-history PostgreSQL proof rejects the forged plan and a transaction
that begins in-window but acquires its lock after closure, with zero network callbacks. No new file,
connector surface, retry/lookup assumption, or production boundary was added.

## Human-authorized official-scale correction

Authoritative PR CI exposed one missed official-scale consumer family: the WP7B representative
segment and canonical throughput probe still required nonzero historical modeled fills, while the
global legacy submit cutover correctly returned `execution_v2_required`. Exact-head reproductions
returned zero fills; the unchanged exact base passed with 562 fills. The Human authorized exactly
those two tests, their shared harness, and `.github/workflows/ci.yml` for loopback PostgreSQL 16 and
TEST_ONLY enablement in only those jobs. The remediation must bind every modeled order to a genuine
`RiskAllowanceV2 → ExecutionPolicyBindingV2 → ExecutionPlanV2 → ExecutionAttemptV2` before the
existing historical exchange receives the effect. Fill/accounting floors remain unchanged; no
production runtime, legacy bypass, fabricated connector fill, or HTX behavior is admitted. The
umbrella unit failure is the already-admitted static consumer test's stale two-argument dispatcher
string after sealed-timeout propagation, not a separate semantic failure.

## Reviewability and rollback

The batch intentionally exceeds the normal ~800-line/~20-file target because the Human ratified one
authority invariant and one rollback boundary spanning contracts, a single additive migration,
transactional persistence, connector effect semantics, and every caller. Splitting PRs would create
an unsafe interval where legacy callers can bypass the new authority or the database substrate lacks
its sole consumer. Reviewability is preserved through four serialized child commits, child-specific
tests and admission reviews, cumulative checks after each child, one frozen manifest, and exact file
mapping.

Rollback is one revert PR. Reverting or applying database changes in any environment is a separate
Human/operator decision; this task performs neither production SQL nor destructive rollback.

## Acceptance

1. Only an exact valid claimed RiskAllowanceV2 bound to a compatible immutable plan and one durable
   attempt can reach a connector effect.
2. Venue/order type/TIF/timing/collar/discrete size/rounding/slicing/retry/cancel mechanics remain
   inside the Decision-qualified policy envelope; price chasing and inferred smaller-size economics
   are impossible.
3. Claim, plan, attempt, exact payload, Risk reservation→pending transfer, and append-only bind events
   are atomic and locked; one allowance cannot create two independent attempts.
4. Deterministic effect identity survives restart. Crash proofs cover pre-bind, post-bind/pre-network,
   and post-network timeout without blind resend.
5. HTX timeout/unknown is always FAIL-UNKNOWN and reconciliation-only until venue idempotency is
   separately documented and proven.
6. No synthetic trade/fill, invented price/quantity/fee/fee asset/trade identity, or connector-status
   promotion to canonical Reality truth remains.
7. Raw reports are append-only, digest-chained, replayable observations for rejection, partial fill,
   residual, cancel, pre-sealed replace, exact fill reports, uncertainty, and reconciliation.
8. The additive migration creates exactly four V2 tables plus necessary nullable V2 order refs,
   preserves tenant-scoped identities/FKs, service-only deny RLS, indexes, and organization integrity,
   and leaves migration 0156/Treasury history byte-identical.
9. Real Postgres tests prove tenant/RLS CRUD denial, append-only guards, locking/concurrency/TOCTOU,
   projection/event consistency, and reservation accounting.
10. Static and runtime whole-repository evidence proves every external connector order submission is
    reachable only from the committed V2 attempt dispatcher; paper/live/guardian/replay/harness paths
    migrate or fail closed.
11. DEE-520 reject/fill/accounting/symbol/resume invariants and historical/paper/live-equivalent
    authority semantics remain green.
12. Exact-head lint, typecheck, build, affected canon/governance, focused nine-surface regression,
    the already completed pre-correction full-suite failure inventory, Postgres evidence, one
    governance-required full local suite on the changed frozen head, independent adversarial review
    with zero P1/P2, authoritative full PR CI, and fresh DEE-653 admission all pass before authorized
    squash merge. An unchanged suite is never repeated.
13. The nine-surface PostgreSQL gate proves a real allowance reservation becomes one pending
    exposure bound to one deterministic order/attempt; restart returns the same effect identity;
    one injected zero-effect timeout records raw uncertainty and reconciliation; a second dispatch
    performs no callback; and the legacy full-historical/session assertions record zero simulated
    submissions, fills, fees, or accounting mutation.
14. The public-ceremony shell asserts `CONTROL_REPLAY=FAIL` with
    `TEST_ONLY_EXECUTION_V2_AUTHORITY_REQUIRED` and stops before authorize-full/full-run without any
    production CLI PostgreSQL wiring.
15. The WP7B representative-segment and canonical-probe gates retain their nonzero modeled
    fill/accounting floors, and every modeled order effect is preceded by a durable TEST_ONLY V2
    allowance→policy→plan→attempt bind. Their two CI jobs alone provision loopback PostgreSQL; the
    legacy submit path remains disabled everywhere.

## Explicit exclusions and STOP gates

- No DEE-620 work. DEE-634 production Decision→Risk→Execution orchestration remains excluded; only
  the explicitly labeled TEST_ONLY port for the nine admitted tests is authorized, and DEE-634
  remains Todo.
- No Decision-economic recomputation, strategy merit, predictive/AI authority, or canonical Reality
  construction.
- No production/live effect, capital promotion, credentials/secrets, security exception, holdout,
  raw storage, destructive operation, release tag, or Execution Server.
- No same-identity HTX retry/lookup assumption. Any newly discovered venue, semantic, security,
  production, or capital choice is a STOP requiring the smallest exact Human decision.

## Work packages

- **WP0 — governed admission:** create exactly DEE-667/668/669/670, commit this canonical plan and
  valid `status: admitted` manifest before implementation, then move DEE-651 and DEE-667 to In Progress.
- **WP1 — DEE-667:** implement/review A; validate contracts, migration identity, Postgres, RLS, tenant
  isolation, and repository behavior; commit one child delivery.
- **WP2 — DEE-668:** implement/review B; run cumulative A+B authority, locking, concurrency, TOCTOU,
  restart, and pre-network crash tests; commit one child delivery.
- **WP3 — DEE-669:** implement/review C; run cumulative A–C fail-unknown, raw-report, replay,
  rejection/partial/residual/cancel-replace and post-network-timeout tests; commit one child delivery.
- **WP4 — DEE-670:** execute caller-map subpackages for paper/live, guardian, replay, and harness;
  implement/review D; run cumulative A–D plus static/runtime forbidden-caller and DEE-520 regressions;
  commit one child delivery.
- **WP5 — freeze/publication:** freeze manifest and exact diff, run the authoritative full local suite
  exactly once plus all remaining gates, obtain one fresh independent exact-head review, reconcile
  current `origin/main`, publish exactly one non-draft PR, wait for CI, run fresh DEE-653 admission,
  and squash-merge only on unchanged PASS. Then verify GitHub/origin/main/Linear exactly once and close
  only the four delivered children and DEE-651.

## Pre-freeze implementation provenance

The authoritative-base rebuild replayed A→B→C→D in order at `7c6f1d4`, `06b997f`, `32b4c59` plus
`627fe3e`, and `f56f4f2` plus `0c1f932`/`4b95e88`/`79da4c7`/`6213891`/`f9714fb`. The Human-authorized
first remediation remained serialized as A `8065711`, B `af61b09`, C `164fbe2`, and D
`47d196a`. The subsequent exact-head findings were remediated without widening scope in A `305bf19`,
C `8550837`, and D `d542e49`. Together they bind planned/exact effect notional to the locked Risk
reservation; reconcile venue client/order identity, price, quantity, fill totals, notional, and cancel
mismatches; derive report lifecycle from report type; retain immutable raw HTX observations; and keep unknown HTX states
FAIL-UNKNOWN without resend or undocumented lookup. Four focused unit files passed 31 tests, and the
real disposable PostgreSQL authority/reconciliation file passed 16 tests, including forged
terminal-report refusal, conservative notional rounding, raw cancel-mismatch preservation, and the
locked-state TOCTOU proof.
The final low-level-boundary remediation remained serialized as A `ecd039d`, B `2dd64d3`, C
`dfee6d2`, and D `b2b00e2`. It removes repository APIs from the public V2 barrel, verifies the locked
allowance/policy/order projection at persistence and dispatch, reconstructs the exact durable effect,
rechecks the timing window immediately before `SUBMIT_STARTED`, makes cancel acknowledgement atomic,
and prevents legacy non-historical terminal cancellation without venue evidence. The real PostgreSQL
authority/reconciliation file now passes 19 tests, including the three new adversarial proofs.
The final transitive-proof correction remained serialized as A `7d1667e` and B `04b8f00`. It
revalidates the sealed plan against the authoritative stored policy, recomputes conservative
plan/slice notional before persistence and restart dispatch, and uses `clock_timestamp()` after all
effect locks. The isolated clean-history PostgreSQL file passes 21 tests, including forged
self-consistent effect-ceiling refusal and lock-wait window expiry with zero network submission.
The subsequent fresh exact-head review found that the generic HTX client could retry a placement
POST and then perform a lookup, that a sole child-slice price could differ from the attempted price,
and that malformed venue identities or missing fee fields could become normalized truth. The
Human-authorized existing-file remediations A `8642540` and D `476f5e2` close those findings without
a fifth connector surface: the exact attempt must equal its sole pre-sealed slice; HTX placement performs exactly one
directly signed POST, performs zero lookup, preserves the native acknowledgement, and always enters
FAIL-UNKNOWN/reconciliation; malformed order identities and incomplete trade-fee evidence retain raw
observations and fail unknown. The previously combined unpushed remediation was mechanically rebuilt
into these file-disjoint child commits with exact content preserved; affected exact-head validation
passes 41 focused tests plus 21 real PostgreSQL authority/recovery tests, the static consumer graph
reports zero violations, typecheck and build pass, and lint reports zero errors. One fresh independent
review remains mandatory on the final governance-frozen head before publication.
That review found four additional evidence-boundary defects, all inside already admitted files. The
serialized C `4745ed5` and D `295e792` remediations now retain mismatching trade observations through
reconciliation, redact transport failures so signed query credentials cannot enter the append-only
ledger, refuse missing native order amount/filled-amount instead of inventing zero, preserve raw trade
rows, and retain observed HTTP status when response-body reading fails. The directly affected suite
passes 44 tests, the real PostgreSQL authority/recovery file passes 21 tests, and typecheck plus scoped
lint pass. No fifth connector surface or new semantic boundary was introduced.
The final D-only `d367460` remediation enforces the sealed policy timeout around exactly one HTX
placement request and converts timeout to FAIL-UNKNOWN without resend or lookup. Potentially echoed
signed response material is recursively redacted before durable observation while an exact digest of
the original response remains available for reconciliation. The directly affected suite passes 46
tests, and typecheck plus scoped lint pass; the change stays inside the admitted dispatcher, connector
types, HTX connector, and HTX connector test surfaces.
The next exact-head review found that the timeout still came from the caller object, ended after
headers, and left hostile credential-bearing JSON keys intact. Serialized B `b1868a0` and D
`454ff96` now source the timeout from the stored policy reloaded under the dispatch lock, keep one
deadline across both request and response-body consumption, and redact sensitive response keys as
well as values while retaining the original response digest. The affected suite passes 47 tests,
the real disposable PostgreSQL authority/recovery file passes 21 tests, and typecheck plus scoped
lint pass without any fifth connector surface.
Earlier frozen-head inventory passed 4,701 tests before the admitted marker correction;
its focused retry passed 13 tests, the nine-file loopback PostgreSQL gate passed 65 tests, and the
eight environment-blocked files passed 35 tests with local permission. The changed exact head now
requires one fresh authoritative full local suite and independent review before publication. No
production database, external connector, live/capital, holdout, security, DEE-620, production
DEE-634 wiring, or Execution Server surface was touched.
