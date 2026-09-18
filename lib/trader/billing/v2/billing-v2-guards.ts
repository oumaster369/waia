import { compareDecimal, isZeroDecimal, parseDecimal } from "@/lib/trader/risk/numeric";

export const BILLING_V2_DIGEST_HEX = /^[0-9a-f]{64}$/;

export function requireBillingV2DigestHex(value: string, code: string): void {
  if (!BILLING_V2_DIGEST_HEX.test(value)) {
    throw new Error(code);
  }
}

export function requireBillingV2NonEmpty(value: string, code: string): void {
  if (value.trim() === "") {
    throw new Error(code);
  }
}

export function requireBillingV2IsoUtc(value: string, code: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(code);
  }
}

export function requireBillingV2Decimal(value: string, code: string): void {
  try {
    parseDecimal(value);
  } catch {
    throw new Error(code);
  }
}

export function requireBillingV2NonNegative(value: string, code: string): void {
  requireBillingV2Decimal(value, code);
  if (compareDecimal(value, "0") < 0) {
    throw new Error(code);
  }
}

export function requireBillingV2ZeroQuantity(value: string, code: string): void {
  requireBillingV2Decimal(value, code);
  if (!isZeroDecimal(value)) {
    throw new Error(code);
  }
}

export function assertBillingV2ForbiddenKeys(
  input: object,
  keys: readonly string[],
  code: string,
): void {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(code);
    }
  }
}

export const BILLING_V2_NAKED_FINANCIAL_KEYS = [
  "realizedPnl",
  "unrealizedPnl",
  "equity",
  "equityHwm",
  "feeRate",
  "netDeposits",
  "netWithdrawals",
  "deposits",
  "withdrawals",
] as const;
