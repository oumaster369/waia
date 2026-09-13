/** Node-only durable range scheduler. Worker count is a deployment resource only. */
import { Worker } from "node:worker_threads";
import { join } from "node:path";

import {
  aggregateValidationBootstrapCoverageV1,
  digestValidationBootstrapInputV1,
  partitionValidationBootstrapDurableRangesV1,
  refuseNativeBootstrapLedgerAdmissionV1,
  sealValidationBootstrapRangeRecordV1,
  validationBootstrapSchedulerRuntimeIdentityV1,
  type DeclaredHistoricalRunTupleV1,
  type MandatoryBaselineIdV1,
  type ValidationBootstrapDurableStoreV1,
  type ValidationBootstrapSealedRangeRecordV1,
} from "../../lib/trader/research/benchmark/validation-bootstrap-durable-v1";
import {
  deriveValidationBootstrapRoot,
  INTERNAL_createValidationBootstrapRangeEvaluatorV1,
  INTERNAL_validationBootstrapOrdinalRangeV1,
  VALIDATION_BOOTSTRAP_B,
  type ValidationBootstrapExecutionV1,
  type ValidationBootstrapNullCenteredResultV1,
} from "../../lib/trader/research/benchmark/validation-bootstrap-v1";

type RangeResult = ReturnType<typeof INTERNAL_validationBootstrapOrdinalRangeV1>;

export type ValidationBootstrapDurableJobV1 = Readonly<{
  store: ValidationBootstrapDurableStoreV1;
  declaredTuple: DeclaredHistoricalRunTupleV1;
  surface: string;
  baseline: MandatoryBaselineIdV1;
  differentials: readonly number[];
  trialIdentityDigest32: Buffer;
  signal?: AbortSignal;
  onProgress?: ValidationBootstrapExecutionV1["onProgress"];
  workerCount?: number;
}>;

function fail(reason: string): never {
  throw new Error(`VALIDATION_BOOTSTRAP_DURABLE_REFUSED:${reason}`);
}

function identityOf(job: ValidationBootstrapDurableJobV1, start: number, endExclusive: number) {
  return {
    declaredTuple: job.declaredTuple,
    surface: job.surface,
    baseline: job.baseline,
    trialIdentityDigestHex: job.trialIdentityDigest32.toString("hex"),
    inputDigestHex: digestValidationBootstrapInputV1(job.differentials),
    rootSeedHex: deriveValidationBootstrapRoot(job.trialIdentityDigest32).toString("hex"),
    start,
    endExclusive,
  };
}

function persistRange(
  job: ValidationBootstrapDurableJobV1,
  result: RangeResult,
): ValidationBootstrapSealedRangeRecordV1 {
  const record = sealValidationBootstrapRangeRecordV1({
    declaredTuple: job.declaredTuple,
    surface: job.surface,
    baseline: job.baseline,
    trialIdentityDigest32: job.trialIdentityDigest32,
    differentials: job.differentials,
    start: result.start,
    endExclusive: result.endExclusive,
    extremeCount: result.extremeCount,
    n: result.n,
    dBar: result.dBar,
    tObs: result.tObs,
    centeredMean: result.centeredMean,
  });
  job.store.sealRange(record);
  return record;
}

/** Exact validation-bootstrap/v2 over durable 8-ordinal ranges. Never emits pRaw early. */
export async function runValidationBootstrapDurableSchedulerV1(
  job: ValidationBootstrapDurableJobV1,
): Promise<ValidationBootstrapNullCenteredResultV1> {
  refuseNativeBootstrapLedgerAdmissionV1(job);
  job.store.bindRequestTuple(job.declaredTuple);
  const { signal, onProgress } = job;
  const assertActive = () => {
    if (signal?.aborted) throw new Error("VALIDATION_BOOTSTRAP_CANCELLED");
  };
  assertActive();
  const workerCount = job.workerCount ?? 1;
  if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 4) {
    throw new Error("VALIDATION_BOOTSTRAP_WORKERS_MUST_BE_1_TO_4");
  }
  const owned = {
    differentials: [...job.differentials],
    trialIdentityDigest32: Buffer.from(job.trialIdentityDigest32),
  };
  const ownedJob = {
    ...job,
    differentials: owned.differentials,
    trialIdentityDigest32: owned.trialIdentityDigest32,
  };
  const evaluate = INTERNAL_createValidationBootstrapRangeEvaluatorV1(owned);
  const schedulerIdentity = validationBootstrapSchedulerRuntimeIdentityV1();
  const sealed: ValidationBootstrapSealedRangeRecordV1[] = [];
  const pending: Array<{ start: number; endExclusive: number }> = [];
  for (const range of partitionValidationBootstrapDurableRangesV1()) {
    assertActive();
    const existing = ownedJob.store.loadSealedRange(
      identityOf(ownedJob, range.start, range.endExclusive),
    );
    if (existing) sealed.push(existing);
    else pending.push(range);
  }
  const report = () => {
    const completed = sealed.reduce((sum, record) => sum + (record.endExclusive - record.start), 0);
    onProgress?.(Object.freeze({ completed, total: VALIDATION_BOOTSTRAP_B }));
  };
  report();
  if (pending.length === 0) {
    return aggregateValidationBootstrapCoverageV1(sealed, {
      declaredTuple: ownedJob.declaredTuple,
      surface: ownedJob.surface,
      baseline: ownedJob.baseline,
      trialIdentityDigestHex: ownedJob.trialIdentityDigest32.toString("hex"),
      inputDigestHex: digestValidationBootstrapInputV1(ownedJob.differentials),
      rootSeedHex: deriveValidationBootstrapRoot(ownedJob.trialIdentityDigest32).toString("hex"),
      schedulerIdentity,
    });
  }
  if (workerCount === 1) {
    for (const range of pending) {
      assertActive();
      sealed.push(persistRange(ownedJob, evaluate(range.start, range.endExclusive)));
      report();
    }
  } else {
    await evaluatePendingWithWorkers(ownedJob, pending, sealed, workerCount, assertActive, report);
  }
  assertActive();
  return aggregateValidationBootstrapCoverageV1(sealed, {
    declaredTuple: ownedJob.declaredTuple,
    surface: ownedJob.surface,
    baseline: ownedJob.baseline,
    trialIdentityDigestHex: ownedJob.trialIdentityDigest32.toString("hex"),
    inputDigestHex: digestValidationBootstrapInputV1(ownedJob.differentials),
    rootSeedHex: deriveValidationBootstrapRoot(ownedJob.trialIdentityDigest32).toString("hex"),
    schedulerIdentity,
  });
}

async function evaluatePendingWithWorkers(
  job: ValidationBootstrapDurableJobV1,
  pending: Array<{ start: number; endExclusive: number }>,
  sealed: ValidationBootstrapSealedRangeRecordV1[],
  workerCount: number,
  assertActive: () => void,
  report: () => void,
): Promise<void> {
  if (
    typeof process === "undefined" ||
    process.release?.name !== "node" ||
    !process.versions?.node ||
    process.env.WAIA_TRADER_CLI !== "1"
  ) {
    throw new Error("VALIDATION_BOOTSTRAP_NODE_CLI_REQUIRED");
  }
  const workers: Worker[] = [];
  let abort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let next = 0;
      const assignments = new Map<Worker, { start: number; endExclusive: number }>();
      const failOut = (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      abort = () => failOut(new Error("VALIDATION_BOOTSTRAP_CANCELLED"));
      job.signal?.addEventListener("abort", abort, { once: true });
      const assign = (worker: Worker) => {
        if (settled || next === pending.length) return;
        const range = pending[next++]!;
        assignments.set(worker, range);
        worker.postMessage(range);
      };
      try {
        assertActive();
        const poolSize = Math.min(workerCount, pending.length);
        for (let i = 0; i < poolSize; i += 1) {
          const worker = new Worker(
            join(process.cwd(), "scripts/trader/validation-bootstrap-range-worker.mjs"),
            {
              workerData: {
                differentials: job.differentials,
                trialIdentityDigest32: job.trialIdentityDigest32,
              },
              execArgv: [],
            },
          );
          workers.push(worker);
          worker.on("error", failOut);
          worker.on("exit", (code) => {
            if (!settled) failOut(new Error(`VALIDATION_BOOTSTRAP_WORKER_EXIT:${code}`));
          });
          worker.on("message", (message: unknown) => {
            if (settled) return;
            try {
              assertActive();
              const payload = message as {
                ok?: boolean;
                result?: RangeResult;
                error?: string;
              } | null;
              if (payload?.ok !== true || !payload.result) {
                throw new Error(
                  `VALIDATION_BOOTSTRAP_WORKER_FAILURE:${payload?.error ?? "INVALID_RESULT"}`,
                );
              }
              const assigned = assignments.get(worker);
              const result = payload.result;
              if (
                !assigned ||
                result.start !== assigned.start ||
                result.endExclusive !== assigned.endExclusive
              ) {
                fail("WORKER_RANGE_MISMATCH");
              }
              assignments.delete(worker);
              sealed.push(persistRange(job, result));
              report();
              if (assignments.size === 0 && next === pending.length) {
                settled = true;
                resolve();
              } else {
                assign(worker);
              }
            } catch (error) {
              failOut(error);
            }
          });
          assign(worker);
        }
        if (pending.length === 0) {
          settled = true;
          resolve();
        }
      } catch (error) {
        failOut(error);
      }
    });
  } finally {
    if (abort) job.signal?.removeEventListener("abort", abort);
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}
