import { createHash } from "node:crypto";

import { VALIDATION_BOOTSTRAP_ROOT_PREFIX_16 } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  computeStationaryBootstrapBlockLength,
  stationaryBootstrapV1,
} from "@/lib/trader/intelligence/forecast-v2/stationary-bootstrap-v1";
import { CBRNG_DOMAIN_VALBOOT1 } from "@/lib/trader/intelligence/forecast-v2/constants";
import { createWaiaUnbiasedIntV1 } from "@/lib/trader/intelligence/forecast-v2/waia-cbrng-v1";

export const VALIDATION_BOOTSTRAP_B = 10_000 as const;
// DEE-947 evidence revision; never relabel old 1/n qualification outputs.
export const VALIDATION_BOOTSTRAP_VERSION = "validation-bootstrap/v2" as const;
export const VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR = VALIDATION_BOOTSTRAP_B + 1;

export type ValidationBootstrapNullCenteredResultV1 = {
  pRaw: number;
  dBar: number;
  tObs: number;
  extremeCount: number;
  centeredMean: number;
  n: number;
};

function finiteStatistic(value: number, stage: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`[validation-bootstrap] non-finite ${stage} — qualification refused`);
  }
  return value;
}

export function deriveValidationBootstrapRoot(trialIdentityDigest32: Buffer): Buffer {
  if (trialIdentityDigest32.length !== 32) {
    throw new Error("[validation-bootstrap] trial identity digest must be 32 bytes");
  }
  return createHash("sha256")
    .update(Buffer.from(VALIDATION_BOOTSTRAP_ROOT_PREFIX_16, "ascii"))
    .update(trialIdentityDigest32)
    .digest();
}

function createValidationIndexWalker(n: number, rootSeed: Buffer) {
  const blockLength = computeStationaryBootstrapBlockLength(n);
  const sourceIndex = createWaiaUnbiasedIntV1({ domain: CBRNG_DOMAIN_VALBOOT1, rootSeed, n });
  const restart = createWaiaUnbiasedIntV1({ domain: CBRNG_DOMAIN_VALBOOT1, rootSeed, n: blockLength });
  return {
    blockLength,
    visit(resampleOrdinal: number, consume: (index: number, position: number) => void): void {
      let index = sourceIndex(resampleOrdinal, 0, 0);
      consume(index, 0);
      for (let position = 1; position < n; position += 1) {
        index = restart(resampleOrdinal, position, 1) === 0
          ? sourceIndex(resampleOrdinal, position, 0)
          : (index + 1) % n;
        consume(index, position);
      }
    },
  };
}

/** VALBOOT1 stationary bootstrap resample (§2.6.1). */
export function validationBootstrapResampleV1<T>(input: {
  source: readonly T[];
  validationBootstrapRoot: Buffer;
  resampleOrdinal: number;
}): { resampled: T[]; indexVector: number[]; blockLength: number } {
  const n = input.source.length;
  const walker = createValidationIndexWalker(n, input.validationBootstrapRoot);
  const indexVector: number[] = new Array(n);
  walker.visit(input.resampleOrdinal, (index, position) => { indexVector[position] = index; });

  return {
    resampled: indexVector.map((index) => input.source[index]!),
    indexVector,
    blockLength: walker.blockLength,
  };
}

/** Null-center paired differentials: c_i = d_i - d_bar (Human-ratified DEE-531). */
export function nullCenterPairedDifferentials(source: readonly number[]): {
  n: number;
  dBar: number;
  centered: number[];
} {
  const n = source.length;
  if (n === 0) {
    throw new Error("[validation-bootstrap] differentials must be non-empty");
  }
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    // Explicit indexing also refuses sparse/undefined inputs. Arithmetic order is unchanged.
    sum = finiteStatistic(sum + finiteStatistic(source[i]!, "differential"), "differential sum");
  }
  const dBar = finiteStatistic(sum / n, "differential mean");
  const centered = source.map((value) => finiteStatistic(value - dBar, "centered differential"));
  return { n, dBar, centered };
}

/** Observed test statistic T_obs = sqrt(n) * d_bar. */
export function observedNullCenteredBootstrapStatistic(differentials: readonly number[]): number {
  const { n, dBar } = nullCenterPairedDifferentials(differentials);
  return finiteStatistic(Math.sqrt(n) * dBar, "observed statistic");
}

/**
 * Raw one-sided WF_PREDICTIVE admission p-value (Human-ratified DEE-531):
 * bootstrap null-centered c; T*_b = sqrt(n)*mean(c*_b); p = (|{T*_b >= T_obs}| + 1)/(B+1).
 */
function* validationBootstrapSteps(input: {
  differentials: readonly number[];
  trialIdentityDigest32: Buffer;
}): Generator<number, ValidationBootstrapNullCenteredResultV1, void> {
  const { n, dBar, centered } = nullCenterPairedDifferentials(input.differentials);
  const tObs = finiteStatistic(Math.sqrt(n) * dBar, "observed statistic");
  const centeredMean = finiteStatistic(centered.reduce((acc, value) =>
    finiteStatistic(acc + value, "centered sum"), 0) / n, "centered mean");
  const root = deriveValidationBootstrapRoot(input.trialIdentityDigest32);
  const walker = createValidationIndexWalker(n, root);

  let extremeCount = 0;
  for (let b = 0; b < VALIDATION_BOOTSTRAP_B; b += 1) {
    let sum = 0;
    // Exactly the old left-to-right reduce order, without per-resample O(n) arrays.
    walker.visit(b, (index) => { sum = finiteStatistic(sum + centered[index]!, "resample sum"); });
    const tStar = finiteStatistic(Math.sqrt(n) * (sum / n), "resample statistic");
    if (tStar >= tObs) {
      extremeCount += 1;
    }
    yield b + 1;
  }

  const pRaw = (extremeCount + 1) / VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR;

  return {
    pRaw,
    dBar,
    tObs,
    extremeCount,
    centeredMean,
    n,
  };
}

export function validationBootstrapPValueV1(
  input: Parameters<typeof validationBootstrapSteps>[0],
): ValidationBootstrapNullCenteredResultV1 {
  const steps = validationBootstrapSteps(input);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export type ValidationBootstrapExecutionV1 = Readonly<{
  signal?: AbortSignal;
  onProgress?: (progress: Readonly<{ completed: number; total: typeof VALIDATION_BOOTSTRAP_B }>) => void;
}>;

/** Same complete B=10000 computation, yielding only BETWEEN whole resamples.
 * This is cooperative scheduling, not parallel speedup or durable resume.
 * Callbacks receive counts only and cannot inject bootstrap results/authority.
 */
export async function validationBootstrapPValueAsyncV1(
  input: Parameters<typeof validationBootstrapSteps>[0],
  execution: ValidationBootstrapExecutionV1 = {},
): Promise<ValidationBootstrapNullCenteredResultV1> {
  const { signal, onProgress } = execution;
  const assertActive = () => {
    if (signal?.aborted) throw new Error("VALIDATION_BOOTSTRAP_CANCELLED");
  };
  assertActive();
  const quantum = Math.max(1, Math.min(250, Math.floor(250_000 / input.differentials.length)));
  const steps = validationBootstrapSteps(input);
  // Centering and immutable sampler prefixes are owned before the first await.
  let step = steps.next();
  try {
    while (!step.done) {
      if (step.value % quantum === 0 || step.value === VALIDATION_BOOTSTRAP_B) {
        onProgress?.(Object.freeze({ completed: step.value, total: VALIDATION_BOOTSTRAP_B }));
        assertActive();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        assertActive();
      }
      step = steps.next();
    }
    return step.value;
  } finally {
    // No partial p-value escapes when a callback fails or cancellation occurs.
    steps.return(undefined as never);
  }
}

/** Epistemic bootstrap alias for harness tests. */
export function epistemicBootstrapResampleV1<T>(
  input: Parameters<typeof stationaryBootstrapV1<T>>[0],
): ReturnType<typeof stationaryBootstrapV1<T>> {
  return stationaryBootstrapV1(input);
}
