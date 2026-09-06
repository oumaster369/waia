# DEE-950 bounded qualification cost evidence

## Worker-owned preparation and full-N responsiveness — 2026-09-06 22:37 UTC

Before this change each32-ordinal worker assignment re-centered allN inputs. The worker
now owns prepared centered values, summary statistics and the unchanged addressed walker
once, and evaluates strict ranges through that closure. This is local input reuse, not
cached scientific results or durable qualified-evidence reuse. Chunks are8ordinals instead
of32 to report completed work earlier; the controller still requires exact coverage of
all10000ordinals before any p-value. No float summation order or result version changed.

48targeted tests PASS (21439): fullB independent oracle for1/2/4workers, all-five-baseline
predictive receipt equality, out-of-order prepared range evaluation, caller mutation,
invalid ranges, pre/mid/final cancellation and startup/sink failures. TypeScript/scoped
lint/diff PASS. Final current-source TypeScript, full eslint--quiet and Next production
build47110 PASS. Earlier OpenNext33075 applies to preceding ece9f5b1 wiring checkpoint;
no new OpenNext/combined PostgreSQL or deployed-image proof is inferred from it.

Both local AppleM5/Node22.22.3 probes used syntheticN525600, configuredB10000 and fourworkers;
they deliberately stopped at128completed ordinals, cancelling all in-flight work and
returning NO p-value. These are not corpus qualification or target-host measurements.

| Measured quantity | Before (78975) | After (28225) |
|---|---:|---:|
| First completed-range progress |14312.282ms|3847.172ms|
| Total including awaited termination |14615.052ms|15728.289ms|
| Maximum observed processRSS at callbacks |617447424bytes|560513024bytes|
| Process userCPU |66467602µs|72035158µs|
| Progress events |4|16|

Total time was slower in this bounded run. Do NOT present this as an overall speedup or
derive a full-run deadline: completion bursts and discarded in-flight work invalidate
simple partial-throughput extrapolation. The reproducible responsiveness script now accepts
an optional worker count, preserves its default cooperative8-resample probe and suppresses
parallel partial-run ETA calculations. Command: `WAIA_TRADER_CLI=1 node --import tsx
scripts/trader/benchmark-validation-bootstrap-responsiveness.ts 525600 4`.

Earlier local exact-image build26193 failed on DockerHub base metadata timeout before any
build step. Linux smoke53469 used a cached older image plus current read-only source mounts,
network off, userwaia,1GiB/2CPU/pids256 and passed1/2/4worker exact parity onNode22.23.2.
It is not proof of a rebuilt image. Initial pids64 smoke23501 failed esbuild spawnEAGAIN
without a result. At22:36UTC host public registry endpoint responded401 (expected anonymous
challenge), permitting a bounded base-image pull retry; outcome recorded in root handoff.

## Explicit actual-path Node wiring — 2026-09-06 22:23 UTC

Actual technical-surface builder → async predictive receipt → owned async harness →
fixed external Node executor is now connected behind optional strict deployment setting
`WAIA_FHV_VALIDATION_WORKERS=1..4`. Default unchanged. No HTTP field/caller callback can
provide execution results or a module path. CLI/runtime guard occurs before loading;
all input/options are captured before awaits and every baseline/surface retains full work.
Dockerfile copies both scripts, image preflight checks presence, supervisor forwards only
the validated optional count. Actual Docker image construction remains to be verified.

45targeted tests71532 PASS;54/55broader58185 PASS with health test blocked by listenEPERM.
Same health suite75674 PASS6/6 with approved local port access, then full eslint--quiet PASS.
Thus100distinct tests across10files pass;31actual-worker/receipt tests repeated after the
final external-module correction (73897) also PASS. TypeScript/scopedlint/diff PASS33859.

Initial normal Next/OpenNext builds87861 and91078 failed because Turbopack followed the
worker source into tsx/esbuild native binaries. A worker-site ignore annotation alone did
not resolve it. Corrected the shared async driver's explicit external Node-module boundary:
fixed image-relative fileURL import, bundler ignore annotations, runtime guard, packaging
preflight and no alternate/fallback executor. Normal Next/OpenNext33075 then PASS, producing
`.open-next/worker.js`; no dependency upgrade, compatibility-date/config change or weakened gate.
Native Node22 `--import tsx` CLI smoke outside Vitest also PASS: N31/B10000, extremeCount2682,
pRaw0.2682731726827317 and every returned statistic identical to scalar.

This is local integration evidence only. No production flag, push/merge/deployment, qualified
receipt reuse or live authority. Full-data cost, durable progress/resume, actual immutable-image
smoke and final combined graph/repeat remain open. Earlier not-yet-wired statements below
describe prior checkpoints, not current implementation.

## Exact Node ordinal executor — 2026-09-06 22:03 UTC

Local Node executor now runs fixed32-ordinal chunks on1..4owned worker threads, with
the same shared centering/single-resample kernel as scalar/cooperative computation.
The controller owns input copies, checks assigned bounds/statistics/integer counts,
tracks coverage of each of all10000ordinals, and computes pRaw only after complete
nonoverlapping coverage. Per-resample floating reduction is unchanged. Progress is
frozen counts only. Errors, worker startup failures and cancellation refuse results;
all owned workers are awaited during termination. No caller can supply a range result.
This is **not yet wired into the actual technical-proposal path**, nor durable resume.

Initial ESM tsImport worker loading failed alias resolution (6worker tests failed,
22scalar/cooperative tests passed). Explicit tsconfig did not fix transitive resolution;
relative kernel imports alone exposed extension resolution failure. Switched to installed
tsx's documented CJS `require(specifier, parentURL)` API in the isolated worker; preserved
relative imports in the small pure kernel. Actual worker tests then passed12/12, covering
1/2/4workers against the independently encoded fullB10000 oracle, exact ordinal partition,
input mutation, pre/mid/final cancellation, sink failure and invalid inputs/ranges.
An explicit missing-worker-script refusal regression is included subsequently. No error
was suppressed or production package/dependency upgraded.

60existing shared-kernel/cooperative/known-answer/null-centered/scientific tests passed;
TypeScript/scopedlint/diff passed before the added startup regression. Final checks recorded
in the canonical plan. Earlier fullgraph does not cover the extracted kernel until revalidated.

Bounded `benchmark-validation-bootstrap-parallel.ts 2048` retained B10000 and exact result:
extremeCount4805,pRaw0.48055194480551944. Scalar8735.443ms;2workers11447.284ms(slower);
4workers5323.423ms. This run overlapped other local tests, so it is **not an isolated
speedup/capacity claim**. Both worker runs emitted313progress updates and serviced timers
(993/474ticks respectively). No full corpus, target-host execution, deployment or scientific
qualification result was produced. Do not extrapolate a deadline from these measurements.

## Actual issuer duplicate encoding — 2026-09-06 21:49 UTC

The actual `issueForecastV1` encoded the same K×M×13 sample body twice, once for
Execution and once for Terminal. Both role-specific headers remain mandatory. The
new paired encoder shares only per-sample HALF_UP quantization, feeding exactly the
same ordered body bytes to two independent SHA256 states. Temporary text is bounded
to one13component sample. No pooling, cross-anchor caching, altered draws, probabilities,
sampling/identity version, skipped Forecast, or changed scientific result.

`node --import tsx scripts/trader/benchmark-forecast-issuance-cost.ts 64` uses the real
builder/issuer on synthetic360source anchors, K10/M80,64newanchor issuances per trial.
On Node22.22.3/macOSarm64/AppleM5, three scalar-before trials took496.837/490.068/491.195ms;
paired-after took239.908/228.995/230.791ms. Median speedup2.128× for this bounded
actual-issuer scenario (7.675→3.606ms/issuance), **not a full-preparation speedup or ETA**.
Every before/after trial's combined execution/terminal content digests plus probability
vector hash was identical: `c0f57251e39b56795c2b20aba9baa8fcdc2ddd3eae9914102aeb06df793a58ac`.
Package fit was measured separately29.188/29.601ms; this synthetic fit is not full-corpus
K/M convergence. No production data/process used.

33focused tests passed at the initial implementation:8new paired/scalar byte-parity,
sample-order/mutation, malformed/nonfinite/header refusal regressions, realissuer replay,
existing identity known answers and quantizer boundaries. Broader path/build gates are
being checked separately; this new source change is NOT covered by earlier cumulative
37de0528 fullgraph PASS until reintegrated and verified.

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

## Cooperative implementation and larger-N CPU sample — 2026-09-06 20:51 UTC

Supersedes the earlier statement that no cooperative execution is implemented: the
actual technical-surface builder now awaits the same harness/receipt algorithm with
event-loop yields between complete bootstrap resamples. Both APIs share a private
generator; all B=10000 draws and floating-point reduction order remain identical.
No externally supplied bootstrap result can enter that generator. Optional count
callbacks and cancellation reject partial results; full operator progress/cancel
wiring and durable restart/cache remain outstanding, as does parallel capacity.

Executed `node --import tsx scripts/trader/benchmark-validation-bootstrap-responsiveness.ts 525600`.
This uses synthetic local differentials and deliberately cancels after eight resamples;
it does NOT return a p-value or satisfy scientific qualification. Configured B remains10000.
On AppleM5/Node22.22.3, elapsed1694.071ms, seven serviced timer ticks, maximum RSS156254208bytes,
steady210.384ms/resample after the first sample. Linear estimate0.5844CPUhours per comparison
(11.688CPUhours if hypothetically multiplied by four surfaces and five baselines) is
not a measured target-host/full-data ETA. Actual anchor counts, K/M, Forecast issuance,
I/O and other stages must be measured separately. Do not use the older small-N or
unimplemented prototype measurements as a guaranteed production completion time.

79 focused tests pass, including an independent full-B oracle, all-five-baseline exact
receipt parity, mutation resistance, event-loop servicing and cancellation/failure refusal.
Full local lint/typecheck/Next build pass. No deployment or production data access.
