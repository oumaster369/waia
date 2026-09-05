# DEE-920 independent audit — 2026-09-05

Assessed PR #551 head: `00c3a7dbdeb6172c43ef83a1ae23821618642adb`.
Base: `ace5a1c8eab43079d784067a76dba475714ab2f4`.
The corrections below are a subsequent working-tree change, not an exact-head release sign-off.

## Release verdict

**NOT READY for production rehearsal authorization.** No merge, production migration,
deployment, private exchange credential, real order, capital or holdout action was performed.
User WIP remains untouched. The historical graph and the live execution plane remain
separate acceptance targets.

## Independent findings and bounded corrections

| Finding | Severity | Correction / verification |
| --- | --- | --- |
| Queue refuses RUNNING state one committed cycle behind its checkpoint, before lease-owning claim can recover | P1 | Allow exactly that bounded delta without changing the event; preserve identity/extent checks. New queue regressions pass; actual queue/claim crash window added to the unchanged 35-cycle integration extent, pending exact-head CI. |
| Human UI nested technical candidate need not equal the separate candidate finalized by SQL | P1 | SQL object/equality constraint and independent nested seal/scope validation before display/approval/finalization. Actual runner insert with resealed substituted nested candidate rejected in local cloned DB. |
| Runner can occupy GENERAL knowledge namespace | P1 | Replace org-only checkpoint policies with exact approved historical run/surface/model namespace. Actual runner approved SELECT/INSERT passes; GENERAL and unapproved run INSERT denied. Production checkpoint writes are also exercised by the full graph test. |
| SECURITY DEFINER helpers lack fixed runner organization predicate | P2 | Add explicit organization guard to membership lookup and finalizer proposal lookup. Actual constraint-valid foreign request/proposal/approval chain: runner helper returns null and finalizer fails before payload validation (P0002), while own helper returns owner. Local clone PASS; committed regression pending CI. |
| Denied authenticated admin requests leak their runtime | P2 | Assign runtime before early denial; GET/POST ratification and launch disposal regressions pass. |
| Observer exposes only Forecast authorization summary, not economic distribution | P2 | Join same-org/run/cycle/symbol persisted PIT/bundle; expose seven-bucket terminal probabilities/bounds and horizon, not package corpus/sample arrays. Reject missing/mismatched authorized evidence. Local 35-cycle Admin/tenant projections match exactly. |
| Distinct timestamp-bound Forecast digests could pass without changed economic values | P2 | Retain lineage assertions and additionally require distinct numerical terminal probability vectors. Existing local full run has 20 different probability vectors across 20 authorized forecasts. New full run pending. |
| Knowledge is first visible only on terminal NON_ACTIONABLE cycle; no actionable future knowledge link is proven | P2 / acceptance gap | Unresolved. Do not treat empty-link chronological checks as proof of actionable consumption. |

## Learning boundary (not a timeout defect)

The implementation records resolved/scored outcomes, calibration snapshots and versioned
future-visible evidence. Its current governed update contract is explicitly evidence-only:
prior equals posterior and delta is zero. Forecast validates the knowledge snapshot as
provenance but does not adapt the ratified predictive package from these new outcomes.
No claim of causal adaptive Forecast or autonomous strategy research is justified.
The frozen specification `docs/plans/dee-633-forecast-knowledge-feedback.md` explicitly
requires zero delta and forbids direct use of proper scores in Decision/capital.
Introducing a numerical calibration transform therefore requires a separately specified
scientific contract, not an unreviewed change to sizing or Risk. A later authorized Forecast
consuming the new snapshot as provenance is a narrower, independently testable requirement.

For the existing qualified bar fixture, the first later applicable liquidity-sweep
hypothesis is sequence 79, not 35 or 36 (independent pure reconstruction probe).
The approved extent is 35. A valid extended proof requires either a separately predefined
qualified fixture, or upfront authorization of an 80-cycle test fixture with contiguous
execution. Never rehash existing Human authority or skip cycles to force this proof.

Gross buy-and-hold is already implemented by the read model. Its convention is
`GROSS_MARK_TO_MARKET_NO_FEES`; net strategy minus gross benchmark is not matched-cost alpha.

## Validation performed

- Combined focused regressions: 40/40 passed across seven files; subsequent six-file
  rerun: 37/37 passed (proposal, lifecycle restart, observer, both handlers, split migration).
- Typecheck passed; targeted lint: zero errors, existing unused `policyConfig` warning.
- Local cloned PostgreSQL, actual `SET LOCAL ROLE waia_historical_runner`: approved
  checkpoint SELECT/INSERT accepted; GENERAL/unapproved checkpoint writes and displayed
  candidate substitution rejected. All test writes rolled back.
- Actual local full-run observer projection: 35 cycles, 20 authorized forecasts,
  Admin/tenant account histories byte-equivalent; aggregate payload approximately 333 KB.
  This is not a production browser or Cloudflare load test.
- Fresh local migration chain through 0202, including edited unapplied 0201: PASS.
- Full first-cycle/35-cycle integration on new empty local database: 6/6 PASS,
  1424.69 seconds total; 35-cycle body 1060.293 seconds. This process loaded the test
  before the later queue/claim crash-window, foreign-org and named-forgery case additions.
  It includes the revised namespace policies and numerical distribution diversity assertion.
- Foreign approved-proposal regression extracted from the test and executed on the local
  clone with the revised definer functions: PASS. No RLS/constraint/trigger disablement;
  all fixture writes rolled back.
- Five authority-forgery queries profiled on the local clone: all rejected with 23514;
  individual query times 1–80 ms, JS clone/reseal under 1 ms. This does not establish the
  CI-specific slowdown cause. Split the shared 5-second case into five named cases,
  preserving the same per-case default, mutations, role checks and durable equality.

Original-head GitHub CI run 33962882102 completed successfully. PostgreSQL run
33962882277 failed only on the five-forgery test's default 5000-ms timeout; its full
35-cycle proof PASSED in 2697065 ms. No further timeout increase was made.
These statuses do not validate the subsequent corrections.

## Remaining gates

1. Exact correction-head PostgreSQL CI, including the newly added regression cases.
2. Verify complete queue/claim crash recovery and foreign approved-chain negatives in CI.
3. Resolve actionable future knowledge consumption evidence and explicitly settle the
   governed causal-learning contract; do not silently change zero-delta semantics.
4. Independent correction review, exact final head CI/build/E2E/role/tenant/security gates.
5. Request exact squash-merge permission only after P1=0/P2=0.
6. After merge, request exact squash SHA rollout and missing production migrations.
7. Controlled rollout, runtime receipt, small rehearsal and independent deterministic
   repeat, actual browser parity and verified links.

Tenant observer currently requires `account_id` as well as `campaign_run_id`; a final
link must contain the actual modeled account identity. Neither a generic link nor local
projection parity establishes production observation readiness.

## Follow-up at 13:30 UTC — e9a887ea plus uncommitted corrections

User explicitly accepted the first observed test within the evidence-only / zero-delta
contract. Adaptive numerical learning is a separate scientifically specified stage.
This does not waive nonempty subsequent authorized knowledge-consumption evidence,
nor grant merge or deployment authority. Recorded in DEE-920 comment
`ad95dd9a-1f1e-487f-a982-578466c8e7c8`.

Whole-scope independent review found two further P2 cases after the initial corrections:

- Repeated lifecycle publication errors after an atomic commit could append FAILED at
  the old frontier, preventing recovery. The orchestrator now tracks observed committed
  progress separately, suppresses stale retry/STOPPED/FAILED publication and propagates
  the error while preserving lease-owning restart reconciliation. Three new cases failed
  before the fix and pass afterwards; orchestrator + restart tests 14/14, typecheck PASS.
- Knowledge namespace prefix matching admitted an unapproved colon-prefixed child run.
  SQL now compares exact approved trial identity or approved surface and finite bootstrap
  names. Existing colon-containing run IDs remain supported. Actual constrained-role
  positive/negative checks on four surfaces PASS in a disposable clone with rollback.

Both bounded corrections have independent read-only review with no remaining P1/P2 in
those scopes, but are not yet committed or CI-validated.

The opt-in `WAIA_HISTORICAL_KNOWLEDGE_CONTINUATION_PROOF=1` test sets an 80-cycle extent
before its local request/ratification fixture, preserves all original first35 assertions,
then continues sequences35..79 without changing OHLCV or skipping cycles. Expected
nonempty authorized knowledge consumption at79 is NOT yet proven. Local process started
with `/tmp/waia-astra-learning-validation.cjs`, new DB `waia_hsv2_it_astralearning`;
fresh migrations through0202 PASS (2049ms), targeted continuation suite IN PROGRESS.
Do not restart this process or represent the optional test as a completed CI gate.

GitHub e9a887ea CI33967223941 and PostgreSQL33967223934 remain in progress. E2E is a
downstream real CI job, not yet established by short-check success. Same-cycle retry is
idempotency, not an independent fresh-state deterministic repeat; that proof and actual
Historical V2 browser parity still remain mandatory.

Read-only production inventory corrects the rollout packet: Supabase history/catalog
show0191/0192 applied, but Drizzle's canonical journal ends0190. Before0193–0202, verify
equivalence and request explicit journal reconciliation rather than rerun already-applied
DDL. Cloudflare still reports WAIA_RELEASE_SHA920b9609151b48dcbc15947547bec67c3be546cc;
execution-server current remains0d19765d766818733dab7f3161380eea4f8a55a1 with no active
historical container. No production writes were performed.

13:46 UTC update: PostgreSQL CI33967223934 on e9a887ea is SUCCESS, completed13:41:07;
20/20 files,143 passed/2 skipped,2923.32s total,35-cycle body1841072ms. Regular CI unit
job remains active. Local80 proof reached checkpoint23 by13:48 UTC. A read-only progress
query caught a column-name typo in the newly added final continuation assertion:
`cycle_sequence` must be `committed_cycle_sequence`. Working-tree assertion is corrected;
the running Vitest process already loaded the old assertion. Do not interrupt its costly
contiguous graph: validate the corrected final query independently against its persisted
result, and do not label that process exit PASS if its stale assertion subsequently fails.
The new authorized Forecast/knowledge join was separately executed against the actual
local schema and is syntactically valid; currently no links exist before eligible cycle79.

13:57 UTC: all reported CI checks on e9a887ea SUCCESS, including unit/build/E2E in
33967223941 and PostgreSQL33967223934. Local continuation reached45 committed cycles
(last sequence44); it remains IN PROGRESS. Publishing the bounded corrections now starts
their exact-head gates in parallel and does not imply continuation or production PASS.

## 15:40 UTC — reproduced CI connection-lifetime defect

On head3478dda6f93961b9ecacf6638bc56ea2dda2a2aa, PostgreSQL run33970597497
failed only the first rehashed knowledge-authority negative at5002ms. The35-cycle
graph passed2700725ms;142 tests passed,1 failed,3 skipped. Other CI, including
unit/build/E2E, passed. This is not an assertion showing forged authority accepted.

Bounded diagnosis reused disposable DB `waia_hsv2_it_astrarepeat3478`, without
rebuilding fixtures or rerunning the35-cycle graph:

- Three standalone actual-runner attempts rejected with23514 and
  `KNOWLEDGE_DURABLE_BINDING`; persisted authority remained unchanged.
- The exact two rollback-only predecessor tests plus five forgery cases passed
  in157ms with a fresh default pool.
- To reproduce expiry without waiting30–60min, set only the diagnostic pool's
  `max_lifetime:1`, reserve both held and runner slots, run `pg_sleep(1.2)` on
  the runner, release it, and execute the unchanged seven-test sequence.
  The first knowledge case alone timed out twice (5005ms/5011ms); six passed.
  Phase markers locate the stall in `pool.reserve()`, after proposal SELECT
  completed in3.37ms and before SET ROLE or the finalizer query.
- Installed postgres.js defers expiry of explicit reservations. Releasing an
  expired slot lets its next normal query complete before closure. A concurrent
  reserve can be dequeued by onclose during reconnect and then lose its resolver
  at the handshake. The random default30–60min lifetime overlaps the45min proof.
- With timer expiry disabled (`0`, then exact final `null`), the same elapsed
  boundary and all seven assertions passed in1.40s including1.2s deliberate wait.

Minimal correction: only this explicitly owned integration pool uses
`max_lifetime:null`; afterAll still releases backends and ends the pool. Add a
short pool-ownership regression sharing those options, asserting no timer and
successful reacquisition while preserving the held backend. It passed1246ms.
No test timeout, SQL guard, role,35-cycle assertion, formula or runtime changed.
An independent max:1 production-shaped rollover probe reacquired in2.39ms;
the local max:3 failure is not evidence of a production-consumer defect.

Earlier independent80-cycle proof on3478 completed with exit0 on a fresh DB;
comparison with the first persisted80-cycle run passed the explicit semantic/
economic whitelist (digest8825f0970577b5b112d13fd7e4ddbda538ead4cd7ef57e074af60bb76668e41f).
It confirms local graph/evidence repeatability, not adaptive learning, public
HTX dataset qualification, production panels or live readiness. CI on this
new correction is still required before requesting exact merge permission.
