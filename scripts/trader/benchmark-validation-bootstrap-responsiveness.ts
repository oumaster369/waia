/** Synthetic local partial-work measurement; NEVER qualification evidence. */
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { validationBootstrapPValueAsyncV1, VALIDATION_BOOTSTRAP_B } from
  "../../lib/trader/research/benchmark/validation-bootstrap-v1";

async function main() {
  const n = Number(process.argv[2] ?? "525600");
  if (!Number.isSafeInteger(n) || n < 250_001 || n > 1_000_000)
    throw new Error("Synthetic benchmark N must be 250001..1000000");
  const nodeWorkerCount = process.argv[3] === undefined ? undefined : Number(process.argv[3]);
  if (nodeWorkerCount !== undefined &&
    (!Number.isSafeInteger(nodeWorkerCount) || nodeWorkerCount < 1 || nodeWorkerCount > 4)) {
    throw new Error("Synthetic benchmark workers must be 1..4, or omitted for cooperative execution");
  }
  const measurementStop = nodeWorkerCount === undefined ? 8 : 128;
  const input = { differentials: Array.from({ length: n }, (_, i) => Math.sin(i * 0.731)),
    trialIdentityDigest32: createHash("sha256").update("DEE950-responsiveness-NOT-qualification").digest() };
  const controller = new AbortController();
  const samples: { completed: number; elapsedMs: number; rssBytes: number }[] = [];
  const started = performance.now();
  const cpuStarted = process.cpuUsage();
  let timerTicks = 0;
  const timer = setInterval(() => { timerTicks++; }, 1);
  let cancellationVerified = false;
  try {
    await validationBootstrapPValueAsyncV1(input, { signal: controller.signal, nodeWorkerCount,
      onProgress: ({ completed }) => {
        samples.push({ completed, elapsedMs: performance.now() - started, rssBytes: process.memoryUsage().rss });
        if (completed >= measurementStop) controller.abort();
      } });
    throw new Error("Partial benchmark unexpectedly returned a qualification result");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "VALIDATION_BOOTSTRAP_CANCELLED") throw error;
    cancellationVerified = true;
  } finally { clearInterval(timer); }
  if (samples.at(-1)?.completed !== measurementStop || timerTicks === 0 || !cancellationVerified)
    throw new Error("Responsiveness/cancellation proof failed");
  // Parallel completions arrive in bursts and in-flight work is discarded on cancellation.
  // Do not extrapolate a throughput/ETA from that partial sample.
  const millisecondsPerResample = nodeWorkerCount === undefined
    ? (samples[7]!.elapsedMs - samples[0]!.elapsedMs) / 7 : null;
  console.log(JSON.stringify({ kind: "synthetic-partial-bootstrap-cost-NOT-qualification",
    runtime: process.version, platform: process.platform, cpu: cpus()[0]?.model,
    n, configuredB: VALIDATION_BOOTSTRAP_B, completedForMeasurementOnly: measurementStop,
    nodeWorkerCount: nodeWorkerCount ?? null, elapsedIncludingTerminationMs: performance.now() - started,
    cpuUsageMicros: process.cpuUsage(cpuStarted),
    cancellationVerified, timerTicks, samples, millisecondsPerResample,
    extrapolatedSingleComparisonHours: millisecondsPerResample === null ? null
      : millisecondsPerResample * VALIDATION_BOOTSTRAP_B / 3_600_000,
    limitations: "Only synthetic local CPU measurement. Not target-host/full-data cost, completed p-value, durability or readiness." }, null, 2));
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
