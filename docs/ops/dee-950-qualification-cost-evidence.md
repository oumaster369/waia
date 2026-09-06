# DEE-950 bounded qualification cost evidence

## Actual path and cost boundary

`historical-four-surface-ratified-admission-v2.ts:1544–1566` evaluates issuance at every
WF_PREDICTIVE anchor for each of four surfaces. `research-harness-admission-orchestrator-v1.ts:177–199`
then computes paired differences and B=10000 bootstrap comparisons against five mandatory
baselines; each baseline has its own trial identity/root. The 35 economic replay cycles
do not bound this preparation stage.

For an illustrative N=525600 per surface, the corrected integer L is81. There are
4×5×10000×N=105.12 billion restart/initial positions, plus approximately1.30 billion
restart-source draws (and rare rejection retries). This is a cost model, not a measured
production anchor count or server ETA. It excludes Forecast issuance, canonical hashing,
database I/O, scoring and K/M preparation. These counts cannot be removed by a timeout change.

## Bounded optimization implemented locally

- Bind domain/root/modulus and rejection limit once; reuse a private synchronous preimage.
- Retain the existing SHA256 createHash API; no new Node-only crypto API surface for Worker builds.
- Keep explicit semantic replica/sample/draw/retry addresses. Calls have no sequence-dependent random cursor.
- Share the same corrected stationary index walk between materialized diagnostic resampling
  and ordered p-value folding. The p-value path no longer allocates N index entries plus N
  resampled values for every one of B resamples. Centered input remains O(N), per-resample
  working state O(1). B/N/anchor order and every sum's left-to-right floating operations remain unchanged.
- No prefix-sum regrouping, lower B, baseline skipping, p-value shortcut or criterion relaxation.

DEE-947 is a mandatory integration dependency: this local package incorporates its corrected
validation-bootstrap/v2, harness/v3 and receipt/v3 digest namespace, known-answer tests and
stale-receipt rejection tests from commit b13ec46a. Root integration must retain that work.
It is not a release, and no existing qualification result is relabeled.

Finite input and intermediate-sum/statistic guards now refuse NaN, infinities and arithmetic
overflow. Previously these could yield pRaw=1/10001 because comparisons with NaN are false.
The earlier harness positive fixture had a zero rolling-baseline bucket probability, causing
logScore=-Infinity. That exact fixture remains as a refusal regression. Positive/negative
controls now use full-support history and explicitly assert finite scores for all baselines;
their original QUALIFIED/NO_CHALLENGER_QUALIFIES expectations remain. No epsilon or smoothing
was added to production probabilities, and valid floating summation order is unchanged.

## Executed benchmark, not readiness

Command from repository root:

```bash
node --import tsx scripts/trader/benchmark-validation-bootstrap-cost.ts 128
```

Measured 2026-09-06 on Node22.22.3, macOS arm64, AppleM5,10 logical CPUs. Single process;
This final-code measurement includes finite guards. It is not a target-server capacity run.
Each comparison retains B=10000, N=128,1,280,000 positions.

| Trial | Prior scalar corrected algorithm | Optimized implementation |
|---|---:|---:|
|0|760.860ms|559.698ms|
|1|745.345ms|564.914ms|
|2|742.748ms|611.044ms|

Median speedup: **1.319×**. All result fields matched exactly each run:
extremeCount4702, pRaw0.47025297470252975, dBar0.00472450088787453,
tObs0.053451625848607125, centeredMean−3.0357660829594124e−17.

A preliminary one-shot crypto.hash prototype measured about1.61× for N10000×B20;
it is **not implemented in this package** because adding that API to shared module imports needs separate
Worker compatibility verification. An earlier createHash-only prototype measured about1.36×;
the repository benchmark above is the applicable end-to-end small-N p-value measurement.

Independent oracle tests encode SHA256 preimage bytes, uint64 rejection, integer L and
stationary transitions without importing production RNG/bootstrap helpers. They cover n1/8/9/27/28/31/128,
call-order/root-mutation separation, an actual modulo-rejection draw, invalid inputs and full B10000
small-N p-value parity. Validation results are recorded in the plan; all measurements are local.

## What remains before DEE-950 can close

This speedup does not establish full-data feasibility and does not make the historical test ready.
The dominant number of SHA256 evaluations and full-data Forecast issuance still exist.

The next exact-equivalent execution option is disjoint resample-ordinal batches: retain
all b=0..9999 and all positions in order within each b. Workers return integer extreme
counts for their fixed ordinal interval; summing those counts is exact and order-independent.
Never parallelize/reassociate the floating sum inside a resample or share one baseline's root
with another. Validate complete, non-overlapping interval coverage before computing pRaw.

A future durable cache must bind release/algorithm versions, full input and centered-difference
digests, baseline trial identity/root, B/N/L and exact ordinal range, and verify result digests
and interval coverage on resume. Preserve failed/unqualified outcomes. Reuse creates no Human,
scientific or capital authority and must reject pre-DEE-947 evidence. Progress/cancellation
at completed-batch boundaries can resume unchanged addresses; these mechanisms are design
requirements here, **not implemented features**.

Target-host representative stage benchmarks, memory-bounded parallel capacity, durable progress/
cancellation/reuse verification and actual full-data preparation remain outstanding.
No full-corpus job, production call, migration, deployment or new authority was exercised by this package.
