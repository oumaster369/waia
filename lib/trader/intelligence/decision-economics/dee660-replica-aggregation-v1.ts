import { parseDecimal } from "@/lib/trader/risk/numeric";

import { DEE660_EV_AGGREGATION_POLICY } from "./dee660-decision-evaluation-contract-v1";

export type ExactScaledRationalReceiptV1 = {
  numeratorScale8: string;
  denominator: string;
};

export type DecisionEvRangeV2 = {
  aggregationPolicy: typeof DEE660_EV_AGGREGATION_POLICY;
  muBaseReplicasScale8: readonly string[];
  muLowerReplicasScale8: readonly string[];
  muBaseReplicasExact: readonly ExactScaledRationalReceiptV1[];
  muLowerReplicasExact: readonly ExactScaledRationalReceiptV1[];
  evLower: number;
  evBase: number;
  evUpper: number;
  evLowerScale8: string;
  evBaseScale8: string;
  evUpperScale8: string;
  evLowerExact: ExactScaledRationalReceiptV1;
  evBaseExact: ExactScaledRationalReceiptV1;
  evUpperExact: ExactScaledRationalReceiptV1;
  rangeValid: boolean;
  evLowerPositive: boolean;
};

type ExactScaledRational = { numerator: bigint; denominator: bigint };

export class DecisionReplicaAggregationError extends Error {
  readonly code = "EV_RANGE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "DecisionReplicaAggregationError";
  }
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function rational(numerator: bigint, denominator: bigint): ExactScaledRational {
  if (denominator <= 0n) throw new DecisionReplicaAggregationError("invalid denominator");
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function compareRational(left: ExactScaledRational, right: ExactScaledRational): -1 | 0 | 1 {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function toReceipt(value: ExactScaledRational): ExactScaledRationalReceiptV1 {
  return {
    numeratorScale8: value.numerator.toString(),
    denominator: value.denominator.toString(),
  };
}

function fixedScale8(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100_000_000n;
  const fraction = (absolute % 100_000_000n).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function receiptScale8Truncate(value: ExactScaledRational): string {
  return fixedScale8(value.numerator / value.denominator);
}

function exactReplicaMeanScale8(payoffs: readonly string[]): ExactScaledRational {
  if (payoffs.length === 0) throw new DecisionReplicaAggregationError("empty replica");
  try {
    return rational(
      payoffs.reduce((sum, payoff) => sum + parseDecimal(payoff), 0n),
      BigInt(payoffs.length),
    );
  } catch (error) {
    if (error instanceof DecisionReplicaAggregationError) throw error;
    throw new DecisionReplicaAggregationError("invalid payoff");
  }
}

function exactType7Scale8(
  values: readonly ExactScaledRational[],
  probabilityNumerator: bigint,
  probabilityDenominator: bigint,
): ExactScaledRational {
  if (values.length === 0) throw new DecisionReplicaAggregationError("empty quantile input");
  const sorted = [...values].sort(compareRational);
  if (sorted.length === 1) return sorted[0]!;
  const positionNumerator = BigInt(sorted.length - 1) * probabilityNumerator;
  const lowerIndex = positionNumerator / probabilityDenominator;
  const remainder = positionNumerator % probabilityDenominator;
  const lower = sorted[Number(lowerIndex)]!;
  const upper = sorted[Math.min(sorted.length - 1, Number(lowerIndex) + 1)]!;
  return rational(
    lower.numerator * (probabilityDenominator - remainder) * upper.denominator +
      upper.numerator * remainder * lower.denominator,
    lower.denominator * upper.denominator * probabilityDenominator,
  );
}

function validatePayoffMatrix(input: {
  baseReplicaPayoffsScale8: readonly (readonly string[])[];
  lowerReplicaPayoffsScale8: readonly (readonly string[])[];
}): void {
  if (
    input.baseReplicaPayoffsScale8.length === 0 ||
    input.baseReplicaPayoffsScale8.length !== input.lowerReplicaPayoffsScale8.length
  ) {
    throw new DecisionReplicaAggregationError("replica count mismatch");
  }
  const expectedSampleCount = input.baseReplicaPayoffsScale8[0]!.length;
  if (expectedSampleCount === 0) {
    throw new DecisionReplicaAggregationError("sample count mismatch");
  }
  for (let replica = 0; replica < input.baseReplicaPayoffsScale8.length; replica += 1) {
    const base = input.baseReplicaPayoffsScale8[replica]!;
    const lower = input.lowerReplicaPayoffsScale8[replica]!;
    if (
      base.length !== expectedSampleCount ||
      lower.length !== expectedSampleCount
    ) {
      throw new DecisionReplicaAggregationError("sample count mismatch");
    }
    for (let sample = 0; sample < base.length; sample += 1) {
      try {
        if (parseDecimal(lower[sample]!) > parseDecimal(base[sample]!)) {
          throw new DecisionReplicaAggregationError("lower payoff exceeds base payoff");
        }
      } catch (error) {
        if (error instanceof DecisionReplicaAggregationError) throw error;
        throw new DecisionReplicaAggregationError("invalid payoff");
      }
    }
  }
}

export function aggregateDecisionReplicaPayoffsV1(input: {
  baseReplicaPayoffsScale8: readonly (readonly string[])[];
  lowerReplicaPayoffsScale8: readonly (readonly string[])[];
}): DecisionEvRangeV2 {
  validatePayoffMatrix(input);
  const muBase = input.baseReplicaPayoffsScale8.map(exactReplicaMeanScale8);
  const muLower = input.lowerReplicaPayoffsScale8.map(exactReplicaMeanScale8);
  const evLower = exactType7Scale8(muLower, 1n, 10n);
  const evBase = exactType7Scale8(muBase, 1n, 2n);
  const evUpper = exactType7Scale8(muBase, 9n, 10n);
  const evLowerScale8 = receiptScale8Truncate(evLower);
  const evBaseScale8 = receiptScale8Truncate(evBase);
  const evUpperScale8 = receiptScale8Truncate(evUpper);
  return {
    aggregationPolicy: DEE660_EV_AGGREGATION_POLICY,
    muBaseReplicasScale8: muBase.map(receiptScale8Truncate),
    muLowerReplicasScale8: muLower.map(receiptScale8Truncate),
    muBaseReplicasExact: muBase.map(toReceipt),
    muLowerReplicasExact: muLower.map(toReceipt),
    evLower: Number(evLowerScale8),
    evBase: Number(evBaseScale8),
    evUpper: Number(evUpperScale8),
    evLowerScale8,
    evBaseScale8,
    evUpperScale8,
    evLowerExact: toReceipt(evLower),
    evBaseExact: toReceipt(evBase),
    evUpperExact: toReceipt(evUpper),
    rangeValid:
      compareRational(evLower, evBase) <= 0 && compareRational(evBase, evUpper) <= 0,
    evLowerPositive: evLower.numerator > 0n,
  };
}
