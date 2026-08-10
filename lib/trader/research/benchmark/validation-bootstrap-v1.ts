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

/** Significance bootstrap p-value: fraction of B resamples with statistic >= observed. */
export function validationBootstrapPValueV1(input: {
  source: readonly number[];
  trialIdentityDigest32: Buffer;
  statistic: (sample: readonly number[]) => number;
}): number {
  const observed = input.statistic(input.source);
  const root = deriveValidationBootstrapRoot(input.trialIdentityDigest32);
  let exceed = 0;
  for (let b = 0; b < VALIDATION_BOOTSTRAP_B; b += 1) {
    const resampled = validationBootstrapResampleV1({
      source: input.source,
      validationBootstrapRoot: root,
      resampleOrdinal: b,
    }).resampled;
    if (input.statistic(resampled) >= observed) {
      exceed += 1;
    }
  }
  return (exceed + 1) / (VALIDATION_BOOTSTRAP_B + 1);
}

/** Epistemic bootstrap alias for harness tests. */
export function epistemicBootstrapResampleV1<T>(
  input: Parameters<typeof stationaryBootstrapV1<T>>[0],
): ReturnType<typeof stationaryBootstrapV1<T>> {
  return stationaryBootstrapV1(input);
}
