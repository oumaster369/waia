import { createHash } from "node:crypto";

import { VALIDATION_BOOTSTRAP_ROOT_PREFIX_16 } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  computeStationaryBootstrapBlockLength,
  stationaryBootstrapV1,
} from "@/lib/trader/intelligence/forecast-v2/stationary-bootstrap-v1";
import { CBRNG_DOMAIN_VALBOOT1 } from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  waiaUnbiasedInt,
  type WaiaCbrngAddress,
} from "@/lib/trader/intelligence/forecast-v2/waia-cbrng-v1";

export const VALIDATION_BOOTSTRAP_B = 10_000 as const;
export const VALIDATION_BOOTSTRAP_VERSION = "validation-bootstrap/v1" as const;
export const VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR = VALIDATION_BOOTSTRAP_B + 1;

export type ValidationBootstrapNullCenteredResultV1 = {
  pRaw: number;
  dBar: number;
  tObs: number;
  extremeCount: number;
  centeredMean: number;
  n: number;
};

export function deriveValidationBootstrapRoot(trialIdentityDigest32: Buffer): Buffer {
  if (trialIdentityDigest32.length !== 32) {
    throw new Error("[validation-bootstrap] trial identity digest must be 32 bytes");
  }
  return createHash("sha256")
    .update(Buffer.from(VALIDATION_BOOTSTRAP_ROOT_PREFIX_16, "ascii"))
    .update(trialIdentityDigest32)
    .digest();
}

function valBootAddress(
  rootSeed: Buffer,
  replicaU32: number,
  sampleU32: number,
  drawU32: number,
  retryU32 = 0,
): WaiaCbrngAddress {
  return {
    domain: CBRNG_DOMAIN_VALBOOT1,
    rootSeed,
    replicaU32,
    sampleU32,
    drawU32,
    retryU32,
  };
}

/** VALBOOT1 stationary bootstrap resample (§2.6.1). */
export function validationBootstrapResampleV1<T>(input: {
  source: readonly T[];
  validationBootstrapRoot: Buffer;
  resampleOrdinal: number;
}): { resampled: T[]; indexVector: number[]; blockLength: number } {
  const n = input.source.length;
  const blockLength = computeStationaryBootstrapBlockLength(n);
  const indexVector: number[] = new Array(n);

  indexVector[0] = waiaUnbiasedInt(
    valBootAddress(input.validationBootstrapRoot, input.resampleOrdinal, 0, 0),
    n,
  );

  for (let position = 1; position < n; position += 1) {
    const restart =
      waiaUnbiasedInt(
        valBootAddress(input.validationBootstrapRoot, input.resampleOrdinal, position, 1),
        n,
      ) === 0;
    if (restart) {
      indexVector[position] = waiaUnbiasedInt(
        valBootAddress(input.validationBootstrapRoot, input.resampleOrdinal, position, 0),
        n,
      );
    } else {
      indexVector[position] = (indexVector[position - 1]! + 1) % n;
    }
  }

  return {
    resampled: indexVector.map((index) => input.source[index]!),
    indexVector,
    blockLength,
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
  const dBar = source.reduce((acc, value) => acc + value, 0) / n;
  const centered = source.map((value) => value - dBar);
  return { n, dBar, centered };
}

/** Observed test statistic T_obs = sqrt(n) * d_bar. */
export function observedNullCenteredBootstrapStatistic(differentials: readonly number[]): number {
  const { n, dBar } = nullCenterPairedDifferentials(differentials);
  return Math.sqrt(n) * dBar;
}

/**
 * Raw one-sided WF_PREDICTIVE admission p-value (Human-ratified DEE-531):
 * bootstrap null-centered c; T*_b = sqrt(n)*mean(c*_b); p = (|{T*_b >= T_obs}| + 1)/(B+1).
 */
export function validationBootstrapPValueV1(input: {
  differentials: readonly number[];
  trialIdentityDigest32: Buffer;
}): ValidationBootstrapNullCenteredResultV1 {
  const { n, dBar, centered } = nullCenterPairedDifferentials(input.differentials);
  const tObs = Math.sqrt(n) * dBar;
  const centeredMean = centered.reduce((acc, value) => acc + value, 0) / n;
  const root = deriveValidationBootstrapRoot(input.trialIdentityDigest32);

  let extremeCount = 0;
  for (let b = 0; b < VALIDATION_BOOTSTRAP_B; b += 1) {
    const resampled = validationBootstrapResampleV1({
      source: centered,
      validationBootstrapRoot: root,
      resampleOrdinal: b,
    }).resampled;
    const tStar = Math.sqrt(n) * (resampled.reduce((acc, value) => acc + value, 0) / n);
    if (tStar >= tObs) {
      extremeCount += 1;
    }
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

/** Epistemic bootstrap alias for harness tests. */
export function epistemicBootstrapResampleV1<T>(
  input: Parameters<typeof stationaryBootstrapV1<T>>[0],
): ReturnType<typeof stationaryBootstrapV1<T>> {
  return stationaryBootstrapV1(input);
}
