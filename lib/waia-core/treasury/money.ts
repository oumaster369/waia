import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  TREASURY_USDT_V1_ASSET,
  TREASURY_USDT_V1_DECIMALS,
  USDT_NOMINAL_USD_POLICY_V1,
} from "@/lib/waia-core/treasury/types";

export function requireBigint(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") {
    throw new TreasuryValidationError(
      "BIGINT_REQUIRED",
      `${label} must be bigint; JS Number is not financial authority`,
    );
  }
  return value;
}

export function absMicros(value: bigint): bigint {
  const amount = requireBigint(value, "amount");
  return amount < 0n ? -amount : amount;
}

export function assertNonNegativeMicros(value: bigint, label: string): bigint {
  const amount = requireBigint(value, label);
  if (amount < 0n) {
    throw new TreasuryValidationError("AMOUNT_NEGATIVE", `${label} must be >= 0`);
  }
  return amount;
}

export function assertPositiveMicros(value: bigint, label: string): bigint {
  const amount = requireBigint(value, label);
  if (amount <= 0n) {
    throw new TreasuryValidationError("AMOUNT_NOT_POSITIVE", `${label} must be > 0`);
  }
  return amount;
}

/**
 * USDT_NOMINAL_USD_POLICY_V1: for approved v1 USDT (6 decimals),
 * accounting_amount_micros = native_amount_atomic.
 * Nominal accounting convention, not a market-price assertion.
 */
export function accountingMicrosFromUsdtNominal(input: {
  nativeAmountAtomic: bigint;
  nativeDecimals: number;
  nativeAsset: string;
}): bigint {
  const native = assertNonNegativeMicros(input.nativeAmountAtomic, "nativeAmountAtomic");
  if (
    input.nativeAsset !== TREASURY_USDT_V1_ASSET ||
    input.nativeDecimals !== TREASURY_USDT_V1_DECIMALS
  ) {
    throw new TreasuryValidationError(
      "USDT_NOMINAL_POLICY_MISMATCH",
      `${USDT_NOMINAL_USD_POLICY_V1} requires ${TREASURY_USDT_V1_ASSET} with ${TREASURY_USDT_V1_DECIMALS} decimals`,
    );
  }
  return native;
}

export function isApprovedV1UsdtAsset(input: {
  nativeAsset: string;
  nativeDecimals: number;
  accountingDenominationPolicy: string | null;
}): boolean {
  return (
    input.nativeAsset === TREASURY_USDT_V1_ASSET &&
    input.nativeDecimals === TREASURY_USDT_V1_DECIMALS &&
    input.accountingDenominationPolicy === USDT_NOMINAL_USD_POLICY_V1
  );
}

export function serializeMicros(value: bigint): string {
  return requireBigint(value, "micros").toString(10);
}
