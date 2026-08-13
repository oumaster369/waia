import { STATIONARY_BOOTSTRAP_VERSION } from "./constants";
import { epiBootAddress, waiaUnbiasedInt } from "./waia-cbrng-v1";

export { STATIONARY_BOOTSTRAP_VERSION };

/**
 * Integer-exact block length: smallest positive L with L³ ≥ n (§2.4.0).
 */
export function computeStationaryBootstrapBlockLength(sourceLength: number): number {
  if (!Number.isInteger(sourceLength) || sourceLength <= 0) {
    throw new Error(
      `[forecast-v2/bootstrap] source length must be positive integer, got ${sourceLength}`,
    );
  }
  let blockLength = 1;
  while (blockLength * blockLength * blockLength < sourceLength) {
    blockLength += 1;
  }
  return blockLength;
}

export type StationaryBootstrapInput<T> = {
  source: readonly T[];
  bootstrapRootK: Buffer;
  replicaOrdinal: number;
};

export type StationaryBootstrapResult<T> = {
  resampled: T[];
  indexVector: number[];
  blockLength: number;
};

/**
 * Politis–Romano stationary bootstrap (§2.4.0) with EPIBOOT1 addressing.
 */
export function stationaryBootstrapV1<T>(
  input: StationaryBootstrapInput<T>,
): StationaryBootstrapResult<T> {
  const n = input.source.length;
  const blockLength = computeStationaryBootstrapBlockLength(n);
  const indexVector: number[] = new Array(n);

  indexVector[0] = waiaUnbiasedInt(
    epiBootAddress(input.bootstrapRootK, input.replicaOrdinal, 0, 0),
    n,
  );

  for (let position = 1; position < n; position += 1) {
    const restart =
      waiaUnbiasedInt(
        epiBootAddress(input.bootstrapRootK, input.replicaOrdinal, position, 1),
        blockLength,
      ) === 0;
    if (restart) {
      indexVector[position] = waiaUnbiasedInt(
        epiBootAddress(input.bootstrapRootK, input.replicaOrdinal, position, 0),
        n,
      );
    } else {
      indexVector[position] = (indexVector[position - 1]! + 1) % n;
    }
  }

  const resampled = indexVector.map((index) => input.source[index]!);
  return { resampled, indexVector, blockLength };
}
