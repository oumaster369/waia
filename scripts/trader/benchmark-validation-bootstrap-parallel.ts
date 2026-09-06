/** Full-B, bounded synthetic local CPU comparison; no corpus or readiness claim. */
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { validationBootstrapPValueV1, VALIDATION_BOOTSTRAP_B } from
  "../../lib/trader/research/benchmark/validation-bootstrap-v1";
import { validationBootstrapPValueNodeParallelV1 } from "./validation-bootstrap-node-pool";

async function main() {
  const n = Number(process.argv[2] ?? "2048");
  if (!Number.isSafeInteger(n) || n < 1 || n > 8192) throw new Error("Bounded synthetic N must be1..8192");
  const input = { differentials: Array.from({ length: n }, (_, i) => Math.sin(i * 0.731)),
    trialIdentityDigest32: createHash("sha256").update("DEE950-node-exact-parallel-not-production").digest() };
  const scalarStarted = performance.now();
  const expected = validationBootstrapPValueV1(input);
  const scalarMs = performance.now() - scalarStarted;
  console.log(JSON.stringify({ stage: "scalar", n, b: VALIDATION_BOOTSTRAP_B, elapsedMs: scalarMs }));
  const observations = [];
  for (const workerCount of [2, 4]) {
    let updates = 0;
    let timerTicks = 0;
    const timer = setInterval(() => timerTicks++, 10);
    const started = performance.now();
    try {
      const actual = await validationBootstrapPValueNodeParallelV1(input, { workerCount, onProgress: () => { updates++; } });
      const elapsedMs = performance.now() - started;
      if (!isDeepStrictEqual(actual, expected)) throw new Error("Exact scalar/parallel mismatch");
      const observation = { workerCount, elapsedMs, speedup: scalarMs / elapsedMs, updates, timerTicks };
      observations.push(observation);
      console.log(JSON.stringify(observation));
    } finally { clearInterval(timer); }
  }
  console.log(JSON.stringify({ kind: "full-B-bounded-synthetic-node-parallel-not-readiness", n,
    b: VALIDATION_BOOTSTRAP_B, runtime: process.version, cpu: cpus()[0]?.model, scalarMs, observations,
    exactParity: true, result: expected,
    limitations: "Synthetic local differentials only; not actual full-data target-host preparation or an ETA" }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
