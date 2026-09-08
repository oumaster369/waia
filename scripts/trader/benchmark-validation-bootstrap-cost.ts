/** Bounded CPU microbenchmark, not scientific qualification or a production readiness gate. */
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { waiaUnbiasedInt } from "../../lib/trader/intelligence/forecast-v2/waia-cbrng-v1";
import { computeStationaryBootstrapBlockLength } from "../../lib/trader/intelligence/forecast-v2/stationary-bootstrap-v1";
import { deriveValidationBootstrapRoot, nullCenterPairedDifferentials, validationBootstrapPValueV1,
  VALIDATION_BOOTSTRAP_B } from "../../lib/trader/research/benchmark/validation-bootstrap-v1";

const n = Number(process.argv[2] ?? "128");
if (!Number.isSafeInteger(n) || n < 1 || n > 2048) throw new Error("Benchmark N must be 1..2048; do not run full corpus here");
const source = Array.from({ length: n }, (_, i) => Math.sin(i * 0.731) + (i % 3 - 1) * 1e-12);
const trial = createHash("sha256").update("DEE950-bounded-cost-not-production").digest();

// The pre-optimization scalar implementation, with DEE-947's corrected L. This is
// intentionally separate from the independently encoded mathematical oracle in tests.
function scalarReference() {
  const { dBar, centered } = nullCenterPairedDifferentials(source);
  const tObs = Math.sqrt(n) * dBar;
  const centeredMean = centered.reduce((sum, v) => sum + v, 0) / n;
  const rootSeed = deriveValidationBootstrapRoot(trial);
  const blockLength = computeStationaryBootstrapBlockLength(n);
  let extremeCount = 0;
  for (let b = 0; b < VALIDATION_BOOTSTRAP_B; b += 1) {
    const draw = (position: number, kind: number, bound: number) => waiaUnbiasedInt({
      domain: "VALBOOT1", rootSeed, replicaU32: b, sampleU32: position, drawU32: kind, retryU32: 0 }, bound);
    const indices = new Array<number>(n);
    indices[0] = draw(0, 0, n);
    for (let j = 1; j < n; j += 1) indices[j] = draw(j, 1, blockLength) === 0 ? draw(j, 0, n) : (indices[j - 1]! + 1) % n;
    const resampled = indices.map(i => centered[i]!);
    const tStar = Math.sqrt(n) * (resampled.reduce((sum, v) => sum + v, 0) / n);
    if (tStar >= tObs) extremeCount += 1;
  }
  return { pRaw: (extremeCount + 1) / (VALIDATION_BOOTSTRAP_B + 1), dBar, tObs, extremeCount, centeredMean, n };
}

const observations: Array<{ trial: number; scalarMs: number; optimizedMs: number }> = [];
let finalResult: ReturnType<typeof scalarReference> | null = null;
for (let trialOrdinal = 0; trialOrdinal < 3; trialOrdinal += 1) {
  const started = performance.now();
  const reference = scalarReference();
  const scalarMs = performance.now() - started;
  const optimizedStarted = performance.now();
  const actual = validationBootstrapPValueV1({ differentials: source, trialIdentityDigest32: trial });
  const optimizedMs = performance.now() - optimizedStarted;
  if (JSON.stringify(actual) !== JSON.stringify(reference)) throw new Error("Exact result mismatch; benchmark refused");
  observations.push({ trial: trialOrdinal, scalarMs, optimizedMs });
  finalResult = actual;
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[1]!;
console.log(JSON.stringify({ kind: "bounded-bootstrap-microbenchmark-not-readiness", runtime: process.version,
  platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
  n, b: VALIDATION_BOOTSTRAP_B, positionsPerComparison: n * VALIDATION_BOOTSTRAP_B,
  exactParity: true, result: finalResult, observations,
  medianSpeedup: median(observations.map(v => v.scalarMs)) / median(observations.map(v => v.optimizedMs)),
  limitations: "No full corpus, Forecast issuance, target server, concurrency, durable reuse, or readiness proof" }, null, 2));
