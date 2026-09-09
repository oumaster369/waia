/** Node-only executor for exact disjoint bootstrap ranges, selected explicitly by the async kernel. */
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { deriveValidationBootstrapRoot, nullCenterPairedDifferentials,
  VALIDATION_BOOTSTRAP_B, VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR,
  type ValidationBootstrapExecutionV1, type ValidationBootstrapNullCenteredResultV1,
  type INTERNAL_validationBootstrapOrdinalRangeV1 } from
  "../../lib/trader/research/benchmark/validation-bootstrap-v1";

type RangeResult = ReturnType<typeof INTERNAL_validationBootstrapOrdinalRangeV1>;
type Input = Parameters<typeof INTERNAL_validationBootstrapOrdinalRangeV1>[0];
const RANGE_SIZE = 8;

/** Only trusted local worker channels supply range results; callers cannot inject them. */
export async function validationBootstrapPValueNodeParallelV1(
  input: Input,
  execution: ValidationBootstrapExecutionV1 & Readonly<{ workerCount?: number }> = {},
): Promise<ValidationBootstrapNullCenteredResultV1> {
  const { signal, onProgress, workerCount = 2 } = execution;
  const assertActive = () => { if (signal?.aborted) throw new Error("VALIDATION_BOOTSTRAP_CANCELLED"); };
  assertActive();
  if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 4) {
    throw new Error("VALIDATION_BOOTSTRAP_WORKERS_MUST_BE_1_TO_4");
  }
  // Workers receive copies, never caller memory or shared writable arrays.
  const owned = { differentials: [...input.differentials], trialIdentityDigest32: Buffer.from(input.trialIdentityDigest32) };
  deriveValidationBootstrapRoot(owned.trialIdentityDigest32);
  const { n, dBar, centered } = nullCenterPairedDifferentials(owned.differentials);
  const tObs = Math.sqrt(n) * dBar;
  const centeredMean = centered.reduce((sum, value) => sum + value, 0) / n;
  if (!Number.isFinite(tObs) || !Number.isFinite(centeredMean)) {
    throw new Error("[validation-bootstrap] non-finite statistic — qualification refused");
  }
  const workers: Worker[] = [];
  let abort: (() => void) | undefined;
  try {
    return await new Promise<ValidationBootstrapNullCenteredResultV1>((resolve, reject) => {
      let settled = false;
      let nextStart = 0;
      let completed = 0;
      let extremeCount = 0;
      const coverage = new Uint8Array(VALIDATION_BOOTSTRAP_B);
      const assignments = new Map<Worker, { start: number; endExclusive: number }>();
      const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
      abort = () => fail(new Error("VALIDATION_BOOTSTRAP_CANCELLED"));
      signal?.addEventListener("abort", abort, { once: true });
      const assign = (worker: Worker) => {
        if (settled || nextStart === VALIDATION_BOOTSTRAP_B) return;
        const range = { start: nextStart, endExclusive: Math.min(VALIDATION_BOOTSTRAP_B, nextStart + RANGE_SIZE) };
        nextStart = range.endExclusive;
        assignments.set(worker, range);
        worker.postMessage(range);
      };
      try {
        assertActive();
        for (let i = 0; i < workerCount; i++) {
          const worker = new Worker(join(process.cwd(), "scripts/trader/validation-bootstrap-range-worker.mjs"), {
            workerData: owned,
            // Do not inherit inspection, arbitrary preloads or test-runner worker arguments.
            execArgv: [],
          });
          workers.push(worker);
          worker.on("error", fail);
          worker.on("exit", (code) => { if (!settled) fail(new Error(`VALIDATION_BOOTSTRAP_WORKER_EXIT:${code}`)); });
          worker.on("message", (message: unknown) => {
            if (settled) return;
            try {
              assertActive();
              const payload = message as { ok?: boolean; result?: RangeResult; error?: string } | null;
              if (payload?.ok !== true || !payload.result) {
                throw new Error(`VALIDATION_BOOTSTRAP_WORKER_FAILURE:${payload?.error ?? "INVALID_RESULT"}`);
              }
              const result = payload.result;
              const assigned = assignments.get(worker);
              if (!assigned || result.start !== assigned.start || result.endExclusive !== assigned.endExclusive ||
                result.n !== n || !Object.is(result.dBar, dBar) || !Object.is(result.tObs, tObs) ||
                !Object.is(result.centeredMean, centeredMean) || !Number.isSafeInteger(result.extremeCount) ||
                result.extremeCount < 0 || result.extremeCount > result.endExclusive - result.start) {
                throw new Error("VALIDATION_BOOTSTRAP_WORKER_RANGE_MISMATCH");
              }
              for (let b = result.start; b < result.endExclusive; b++) {
                if (coverage[b] !== 0) throw new Error("VALIDATION_BOOTSTRAP_DUPLICATE_ORDINAL");
                coverage[b] = 1;
              }
              assignments.delete(worker);
              completed += result.endExclusive - result.start;
              extremeCount += result.extremeCount;
              onProgress?.(Object.freeze({ completed, total: VALIDATION_BOOTSTRAP_B }));
              assertActive();
              if (completed === VALIDATION_BOOTSTRAP_B) {
                if (assignments.size !== 0 || nextStart !== VALIDATION_BOOTSTRAP_B || coverage.some(value => value !== 1)) {
                  throw new Error("VALIDATION_BOOTSTRAP_INCOMPLETE_COVERAGE");
                }
                settled = true;
                resolve({ n, dBar, tObs, centeredMean, extremeCount,
                  pRaw: (extremeCount + 1) / VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR });
              } else {
                assign(worker);
              }
            } catch (error) { fail(error); }
          });
          assign(worker);
        }
      } catch (error) { fail(error); }
    });
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    // Completion/error/cancellation returns only after every owned worker is reaped.
    await Promise.all(workers.map(worker => worker.terminate()));
  }
}
