import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { absMicros, assertNonNegativeMicros, requireBigint } from "@/lib/waia-core/treasury/money";
import type { TreasuryTxDirection, TreasuryTxKind } from "@/lib/waia-core/treasury/types";

export type CashEffectInput = {
  kind: TreasuryTxKind;
  direction: TreasuryTxDirection;
  accountingAmountMicros: bigint;
  /** Optional signed effect; required only as an explicit witness for CORRECTION / BALANCE_ADJUSTMENT. */
  signedCashEffectMicros?: bigint;
};

export type CashEffectResult = {
  accountingAmountMicros: bigint;
  cashEffectMicros: bigint;
};

const INFLOW_POSITIVE_KINDS = new Set<TreasuryTxKind>([
  "OPENING_BALANCE",
  "CONTRIBUTION",
  "EXTERNAL_INFLOW",
]);

const OUTFLOW_NEGATIVE_KINDS = new Set<TreasuryTxKind>(["EXPENSE", "EXTERNAL_OUTFLOW"]);

const SIGNED_ADJUSTMENT_KINDS = new Set<TreasuryTxKind>(["CORRECTION", "BALANCE_ADJUSTMENT"]);

function assertKindDirection(kind: TreasuryTxKind, direction: TreasuryTxDirection): void {
  if (INFLOW_POSITIVE_KINDS.has(kind) && direction !== "INFLOW") {
    throw new TreasuryValidationError(
      "KIND_DIRECTION_MISMATCH",
      `${kind} requires direction INFLOW`,
    );
  }
  if (OUTFLOW_NEGATIVE_KINDS.has(kind) && direction !== "OUTFLOW") {
    throw new TreasuryValidationError(
      "KIND_DIRECTION_MISMATCH",
      `${kind} requires direction OUTFLOW`,
    );
  }
  if (kind === "INTERNAL_TRANSFER" && direction !== "INTERNAL") {
    throw new TreasuryValidationError(
      "KIND_DIRECTION_MISMATCH",
      "INTERNAL_TRANSFER requires direction INTERNAL",
    );
  }
  if (kind === "REFUND" && direction !== "INFLOW" && direction !== "OUTFLOW") {
    throw new TreasuryValidationError(
      "KIND_DIRECTION_MISMATCH",
      "REFUND requires direction INFLOW or OUTFLOW",
    );
  }
  if (SIGNED_ADJUSTMENT_KINDS.has(kind) && direction !== "INFLOW" && direction !== "OUTFLOW") {
    throw new TreasuryValidationError(
      "KIND_DIRECTION_MISMATCH",
      `${kind} requires direction INFLOW or OUTFLOW`,
    );
  }
}

/**
 * Canonical deterministic cash-effect calculator. One owner of §5.5a / §9.1.
 * A = accounting_amount_micros (magnitude, bigint only).
 */
export function computeCanonicalCashEffect(input: CashEffectInput): CashEffectResult {
  const A = assertNonNegativeMicros(input.accountingAmountMicros, "accountingAmountMicros");
  assertKindDirection(input.kind, input.direction);

  if (input.kind === "INTERNAL_TRANSFER") {
    if (
      input.signedCashEffectMicros !== undefined &&
      requireBigint(input.signedCashEffectMicros, "cashEffect") !== 0n
    ) {
      throw new TreasuryValidationError(
        "CASH_EFFECT_INCONSISTENT",
        "INTERNAL_TRANSFER cash effect must be 0",
      );
    }
    return { accountingAmountMicros: A, cashEffectMicros: 0n };
  }

  if (INFLOW_POSITIVE_KINDS.has(input.kind)) {
    if (A <= 0n) {
      throw new TreasuryValidationError("AMOUNT_NOT_POSITIVE", `${input.kind} requires A > 0`);
    }
    return { accountingAmountMicros: A, cashEffectMicros: A };
  }

  if (OUTFLOW_NEGATIVE_KINDS.has(input.kind)) {
    if (A <= 0n) {
      throw new TreasuryValidationError("AMOUNT_NOT_POSITIVE", `${input.kind} requires A > 0`);
    }
    return { accountingAmountMicros: A, cashEffectMicros: -A };
  }

  if (input.kind === "REFUND") {
    if (A <= 0n) {
      throw new TreasuryValidationError("AMOUNT_NOT_POSITIVE", "REFUND requires A > 0");
    }
    const cashEffectMicros = input.direction === "INFLOW" ? A : -A;
    return { accountingAmountMicros: A, cashEffectMicros };
  }

  const signed =
    input.signedCashEffectMicros !== undefined
      ? requireBigint(input.signedCashEffectMicros, "signedCashEffectMicros")
      : input.direction === "INFLOW"
        ? A
        : -A;

  if (signed === 0n) {
    throw new TreasuryValidationError(
      "CASH_EFFECT_ZERO",
      `${input.kind} signed cash effect must be non-zero`,
    );
  }
  if (signed > 0n && input.direction !== "INFLOW") {
    throw new TreasuryValidationError(
      "CASH_EFFECT_DIRECTION_MISMATCH",
      `${input.kind} positive effect requires INFLOW`,
    );
  }
  if (signed < 0n && input.direction !== "OUTFLOW") {
    throw new TreasuryValidationError(
      "CASH_EFFECT_DIRECTION_MISMATCH",
      `${input.kind} negative effect requires OUTFLOW`,
    );
  }
  const magnitude = absMicros(signed);
  if (magnitude !== A) {
    throw new TreasuryValidationError(
      "CASH_EFFECT_INCONSISTENT",
      `${input.kind} |cash_effect| must equal accounting_amount_micros`,
    );
  }
  return { accountingAmountMicros: A, cashEffectMicros: signed };
}

export function assertCashEffectMatches(
  kind: TreasuryTxKind,
  direction: TreasuryTxDirection,
  accountingAmountMicros: bigint,
  cashEffectMicros: bigint,
): void {
  const expected = computeCanonicalCashEffect({
    kind,
    direction,
    accountingAmountMicros,
    signedCashEffectMicros: cashEffectMicros,
  });
  if (expected.cashEffectMicros !== cashEffectMicros) {
    throw new TreasuryValidationError(
      "CASH_EFFECT_INCONSISTENT",
      `expected cash_effect_micros ${expected.cashEffectMicros.toString(10)}, got ${cashEffectMicros.toString(10)}`,
    );
  }
}
