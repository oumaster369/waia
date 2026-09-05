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
