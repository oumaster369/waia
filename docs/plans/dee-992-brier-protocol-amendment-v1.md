# DEE-992 — proposed Terminal score amendment and preserved-evidence boundary

Status: DRAFT FOR HUMAN SCIENTIFIC RATIFICATION, not active canon, implementation,
release permission or statistical result. Date: 2026-09-12. Owner: root integrator.
Scope: Terminal 7-bucket predictive comparison only. No change to joint 13-D target,
Decision economics, Risk, economic qualification, live authority or blind holdout.

## 1. Why a scientific decision is required

Authenticated original-score diagnostic identified 7,155 +Infinity differences out
of 525,547 BTCUSDT:30 forecasts: rolling-w2000/v1 assigns zero probability to the
observed lower-tail bucket. Saved challenger probabilities are nonzero there.
Receipt: 508aca24ba4bd7f80d84b832f55d5e3bf1ad493354af419cc576c4c6aef1769f.
No new scientific run has occurred; original failure and every observation remain.

DEE-531 explicitly mandates primary multiclass log score. The repository's frozen
DEE-518 plan, line2361, also pins log score, VALBOOT1, B=10000, integer-exact block
length, common anchors, purge/embargo and Holm. DEE-516 lists Brier/RPS as possible
target-appropriate scores but is a synthesis gate, not permission to silently change
DEE-531's concrete choice. DEE-648 preserves preregistered scientific arbitration;
DEE-627 reserves future semantic changes for explicit Human decisions.

Thus early refusal is currently correct; promoting an infinite comparison to PASS
or NO_CHALLENGER_QUALIFIES would not be a valid statistical result.

## 2. Proposed decision A: bounded multiclass Brier reward

For the SAME original seven buckets and their unchanged observed outcome y:

`S(p,y) = -sum(j=0..6) (p[j] - indicator(j=y))^2`.

Larger is better. Per-anchor improvement remains S(challenger,y)-S(baseline,y).
No division by7 or other rescaling. Evaluate j in ascending order; normalize the
result -0 to +0 for serialization only, never modify probabilities. For exact
probability vectors, reward lies in[-2,0] and differences in[-2,2]. Both zero and
one are permitted values; zero support receives a finite penalty, not an exemption.

Validate BEFORE scoring: exactly seven dense numeric finite entries, each in[0,1];
sum within1e-12 of1 using ascending-order binary64 accumulation. Do not normalize,
clip, floor, impute missing values or silently accept sparse arrays. Reject nonfinite
outcome, invalid grid or invalid vector. A floating tolerance is only an input check,
not a scientific smoothing constant. Evaluate all seven terms, not just p[y].

Apply this ONE primary metric to every challenger and all five mandatory baselines
across every preregistered surface; no per-model/per-tail metric selection. Keep the
original log score as explicit secondary diagnostic, including zero-counts and
Infinity/NaN labels. Do not use that secondary report to overrule primary results.

Keep fixed: DEVELOPMENT fitting, target grid, 30/60m horizons, all observations,
all baselines, common PIT-valid anchors, label-window purge/embargo, deterministic
VALBOOT1 dependence method, B=10000, existing integer block-length law, null centering,
positive mean improvement and Holm FWER0.05 on the frozen comparison family.
No modified thresholds, candidate search, tail weights, training, forecasting or
adaptive learning is included. Preserve common-availability requirements; a zero
probability is not missing evidence. Invalid numerical CDF/vector still refuses.

### Why this is reasonable, and its cost

Negative multiclass Brier is a strictly proper probabilistic score on the closed
probability simplex: under true probabilities q, its expected reward is maximized
uniquely by p=q. Expected truthful advantage equals sum_j(p[j]-q[j])^2. This supplies
a finite scoring law for legitimate zero-support empirical forecasts without
inventing positive probabilities. Primary reference: Gneiting & Raftery (2007),
section3, Example1, p363:
https://sites.stat.washington.edu/people/raftery/Research/PDF/Gneiting2007jasa.pdf

This is NOT equivalent to log score: it changes sensitivity to rare, overconfident
errors and may change model rankings. It is a scientific objective change, not proof
that a challenger will qualify or be profitable. Ordered-distance/tail-weighted
alternatives are not silently included. Selection is based on a declared mathematical
domain requirement, not on checking which revised metric makes this run pass.

Alternative B preserves primary log score but needs a separately specified coherent
positive-support model/prior and DEVELOPMENT-only selection rule, changing predictive
distributions and their lineage. Arbitrary epsilon or baseline-only smoothing is
not an acceptable shortcut. No alternative has been tested on saved production
forecasts to choose a winner.

## 3. Acceptance checks prepared before implementation

Known-answer rewards: correct one-hot0; wrong one-hot-2; uniform7-vector -6/7.
Both baseline/challenger zero in the observed bucket must remain finite under A;
the existing log diagnostic must retain its original nonfinite meaning.
Local independent mathematical exercise PASSED 3 known answers and44,100 expected
reward comparisons over210 exact quarter-grid simplex vectors, including boundaries.
Truthful advantage matched squared Euclidean distance within1e-12. No application
imports, real data, forecasts or bootstrap in that exercise. It validates the draft
formula, not implementation or statistical performance.

Required implementation regressions:
1. All seven categories, edges/open tails, zero-support, identical distributions,
   invalid/sparse/nonfinite/unnormalized vectors; no input mutation.
2. Synthetic equal/inferior challenger returns NO_CHALLENGER_QUALIFIES; valid
   superior synthetic case follows the same preregistered significance gates.
3. Full five-baseline coverage and unchanged common-anchor membership; no filtering.
4. Serial/cooperative/worker bootstrap parity and deterministic repeat under new
   trial identity, preserving B=10000 and independent known-answer vectors.
5. Old/mixed score receipt rejected by new active consumers, even if rehashed;
   score metric, formula version and scientific amendment identity are bound.
6. First/next-cycle and four-surface receipt consumers agree on the exact metric;
   no production path silently falls back to log-score literals.
7. Diagnostic refusal, scientific rejection and qualified evidence remain separate;
   no financial authority follows from a score or harness result alone.

## 4. Integration map from inspected code

Paths below are relative to waia-dee991-checkpoint-audit at6ab1b156; re-inventory the
actual implementation head before BUILD because main/other work may move.

| Surface | Required change after ratification |
| --- | --- |
| lib/trader/research/benchmark/target-grid-ceremony-v1.ts | Keep grid/log diagnostics; add separately versioned validated reward |
| lib/trader/research/benchmark/research-harness-admission-orchestrator-v1.ts | Bind primary score, trial metric and harness/receipt version; preserve bootstrap/anchors |
| lib/trader/research/execopp-qualification/scientific-admission-v2.ts | Version identities, terminal receipt and validators; fail closed on old/mixed metrics |
| lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts | New evaluation identity and Terminal stage; preserved-origin mapping cannot be implicit |
| lib/trader/historical-simulation-v2/production-first-cycle-bootstrap-v2.ts | Replace pinned log-score expectation only with newly ratified protocol |
| lib/trader/historical-simulation-v2/production-next-cycle-forecast-v2.ts | Same exact protocol/receipt contract as first cycle |
| scientific-admission four-surface/service consumers and Forecast model registry | Trace schemas/content digests and update exact compatibility tests |

Proposed reserved metric names: multiclass-brier-reward/v1 and
terminal-multiclass-brier-reward/v1. Final schema/version registry must be enumerated
in the implementation PR: bump changed active contracts, retain explicit legacy
read-only interpretation, never accept a broad arbitrary score string/HTTP override.
This document is not authority to deploy version names or modify the original store.

## 5. What can be preserved versus recomputed

| Existing evidence | Disposition |
| --- | --- |
| Source bars, PIT corpus, original package/replica bytes and original forecasts | Preserve immutable. Potential score-independent inputs, not automatically new-release eligible |
| First3 completed log-score bootstrap comparisons | Preserve historical record; cannot be mixed into a Brier family |
| Terminal scores, bootstrap p-values, Holm, terminal admission | Recompute under ONE new metric/protocol after explicit execution approval |
| Dependent selection, runtime qualification, Human proposal/ratification | Revalidate exact provenance/versions; do not transfer old authority |
| Unfinished surfaces/stages | Not manufactured by cache reuse; inventory and remaining generation separately |

Important verified dependency: codeReleaseSha is included in replica-root-family/v1
(identity-digests.ts73–107), which seeds deriveBootstrapRootK in
rv-state-conditional-empirical-joint-v1.ts221–228. A local synthetic identity-only
check confirmed that changing ONLY SHA changes family digest AND bootstrap root;
no sampling or forecast generation was executed. Thus compatibility is not merely
renaming directories. Runtime contract also binds original SHA/Node.

Required preserved-artifact evaluation contract: explicitly distinguish artifact
origin SHA/runtime from evaluator SHA/runtime; bind original package/content/grid,
model/feature/normalization/randomness dependencies, source/evaluation partition,
old-to-new anchor identity mapping and verified expected stage/input keys. Old files
and seals stay untouched. A missing/mismatched input must REFUSE, never call a builder.
Keep source cache read-only; any new result store/receipt namespace is separate and
needs execution approval. No new-SHA label on old artifacts and no authorizing
compatibility merely from identical code file hashes. Live use remains separate.

Changing evaluator score does not scientifically require regenerating every original
forecast, but the current implementation does not provide this admitted dual-origin
path. DEE-991 must prove it before promising avoided generation. No complete reuse
claim, new key manifest, application patch or forecast rerun is delivered here.

## 6. Exposure, other defects and execution gate

This WALK_FORWARD has been inspected after failure; amended evaluation on it is a
disclosed technical/research re-analysis, not untouched confirmatory evidence.
Keep official blind holdout closed. Future untouched/out-of-sample or forward-paper
validation is separate before economic/live claims; no retrospectively selected
score can establish guaranteed profitability.

DEE-993 CDF monotonicity defect is independently open. It is not the rolling-zero
cause, and merely obtaining finite Brier values will not repair it. Correct frozen
CDF semantics/reference checks and define version invalidation before a new full
evaluation. DEE-990 trustworthy completion reporting also remains a separate task.

Decision requested now: ratify A and authorize LOCAL implementation/tests of DEE-992
plus the preserving-origin compatibility contract in DEE-991, including explicit
review of the independent CDF blocker. No push/merge/deployment, no new scientific
run, no checkpoint modifications or private credentials/capital/holdout under this
decision. Execution and rollout permission remain separate after exact-head tests.

Suggested ADR title: Terminal probabilistic scoring on closed support and immutable
origin-aware scientific re-evaluation. Risk T3 semantic; never auto-adopt as docs-only.
