import {
  FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE,
  FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES,
  FORECAST_V2_OFFICIAL_BUNDLE_COUNT,
} from "./storage-scale-projection";

const GIB_BYTES = BigInt(1024 ** 3);

export type A3ExactRationalAggregateMathV1 = {
  schemaVersion: "a3-exact-rational-aggregate-math/v1";
  bundleNumeratorBytes: string;
  bundleDenominator: string;
  bytesPerCompleteBundleNumerator: string;
  bytesPerCompleteBundleDenominator: string;
  bytesPerCompleteBundleDisplay: string;
  totalProjectedNumerator: string;
  totalProjectedDenominator: string;
  totalProjectedDisplayBytes: string;
  totalProjectedDisplayGiB: string;
  passesBytesPerBundleThreshold: boolean;
  passesTotalProjectedThreshold: boolean;
  passesNumeratorPositive: boolean;
  failureReasons: string[];
};

/**
 * Exact terminating-decimal display for a rational (BigInt only; no Number).
 *
 * Converts remainder/denominator by repeated ×10 long division — never string-
 * concatenates the raw remainder (that produced false displays such as
 * 3634.15808 for 726958080/200000 = 3634.7904).
 *
 * Trailing fractional zeros are stripped. Non-terminating expansions fail closed.
 */
export function formatA3ExactRationalDisplay(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) {
    return "undefined";
  }
  if (numerator === 0n) {
    return "0";
  }

  const negative = numerator < 0n !== denominator < 0n;
  let n = numerator < 0n ? -numerator : numerator;
  let d = denominator < 0n ? -denominator : denominator;

  // Reduce so termination detection is against the canonical denominator factors.
  let a = n;
  let b = d;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  const g = a;
  n /= g;
  d /= g;

  const whole = n / d;
  let rem = n % d;
  if (rem === 0n) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }

  const digits: string[] = [];
  const seen = new Map<string, number>();
  while (rem !== 0n) {
    const key = rem.toString();
    if (seen.has(key)) {
      throw new Error(
        `[a3-rational] non-terminating decimal expansion for ${numerator.toString()}/${denominator.toString()}`,
      );
    }
    seen.set(key, digits.length);
    rem *= 10n;
    digits.push((rem / d).toString());
    rem %= d;
  }

  const fractional = digits.join("").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}.${fractional}`;
}

export function evaluateA3ExactRationalAggregateMath(input: {
  b0Bytes: number | bigint;
  b1Bytes: number | bigint;
  packageFixedContributionBytes: number | bigint;
  enumeratedFixedV2OtherBytes: number | bigint;
  nBundles?: number | bigint;
  officialBundleCount?: number | bigint;
}): A3ExactRationalAggregateMathV1 {
  const nBundles = BigInt(input.nBundles ?? 200_000);
  const officialBundleCount = BigInt(
    input.officialBundleCount ?? FORECAST_V2_OFFICIAL_BUNDLE_COUNT,
  );
  const b0 = BigInt(input.b0Bytes);
  const b1 = BigInt(input.b1Bytes);
  const packageFixed = BigInt(input.packageFixedContributionBytes);
  const enumeratedFixedOther = BigInt(input.enumeratedFixedV2OtherBytes);

  const bundleNumeratorBytes = b1 - b0 - packageFixed;
  const bundleDenominator = nBundles;
  const failureReasons: string[] = [];

  const passesNumeratorPositive = bundleNumeratorBytes > 0n;
  if (!passesNumeratorPositive) {
    failureReasons.push(`bundle_numerator_bytes ${bundleNumeratorBytes.toString()} must be > 0`);
  }

  const passesBytesPerBundleThreshold =
    passesNumeratorPositive &&
    bundleNumeratorBytes <= BigInt(FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE) * bundleDenominator;
  if (passesNumeratorPositive && !passesBytesPerBundleThreshold) {
    failureReasons.push(
      `bytes_per_complete_bundle rational ${bundleNumeratorBytes}/${bundleDenominator} exceeds ${FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE}`,
    );
  }

  const totalProjectedNumerator =
    officialBundleCount * bundleNumeratorBytes +
    packageFixed * bundleDenominator +
    enumeratedFixedOther * bundleDenominator;
  const totalProjectedDenominator = bundleDenominator;

  const passesTotalProjectedThreshold =
    totalProjectedNumerator <=
    BigInt(FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES) * totalProjectedDenominator;
  if (!passesTotalProjectedThreshold) {
    failureReasons.push(
      `TOTAL_PROJECTED rational ${totalProjectedNumerator}/${totalProjectedDenominator} exceeds ${FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES}`,
    );
  }

  const totalProjectedDisplayBytes =
    totalProjectedDenominator === 0n
      ? "0"
      : formatA3ExactRationalDisplay(totalProjectedNumerator, totalProjectedDenominator);
  const totalProjectedDisplayGiB =
    totalProjectedDenominator === 0n
      ? "0"
      : formatA3ExactRationalDisplay(
          totalProjectedNumerator,
          totalProjectedDenominator * GIB_BYTES,
        );

  return {
    schemaVersion: "a3-exact-rational-aggregate-math/v1",
    bundleNumeratorBytes: bundleNumeratorBytes.toString(),
    bundleDenominator: bundleDenominator.toString(),
    bytesPerCompleteBundleNumerator: bundleNumeratorBytes.toString(),
    bytesPerCompleteBundleDenominator: bundleDenominator.toString(),
    bytesPerCompleteBundleDisplay: formatA3ExactRationalDisplay(
      bundleNumeratorBytes,
      bundleDenominator,
    ),
    totalProjectedNumerator: totalProjectedNumerator.toString(),
    totalProjectedDenominator: totalProjectedDenominator.toString(),
    totalProjectedDisplayBytes,
    totalProjectedDisplayGiB,
    passesBytesPerBundleThreshold,
    passesTotalProjectedThreshold,
    passesNumeratorPositive,
    failureReasons,
  };
}

export function assertA3ExactRationalAggregateMath(math: A3ExactRationalAggregateMathV1): void {
  if (math.failureReasons.length > 0) {
    throw new Error(`[a3-rational] ${math.failureReasons.join("; ")}`);
  }
}
