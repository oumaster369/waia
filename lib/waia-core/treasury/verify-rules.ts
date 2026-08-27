import { computeCanonicalCashEffect } from "@/lib/waia-core/treasury/cash-effect";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { isApprovedManualUsdAsset, isApprovedV1UsdtAsset } from "@/lib/waia-core/treasury/money";
import {
  MANUAL_ACCOUNTING_CURRENCY_V1,
  USDT_NOMINAL_USD_POLICY_V1,
} from "@/lib/waia-core/treasury/types";
import type {
  TreasuryEvidenceLinkRecord,
  TreasuryObservationRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import { assertWatcherVerifiedPrecondition } from "@/lib/waia-core/treasury/watcher-verify-precondition";

const EVIDENCE_REQUIRED_KINDS = new Set(["OPENING_BALANCE", "CORRECTION", "BALANCE_ADJUSTMENT"]);

export function assertClassifiedSemanticFields(tx: TreasuryTransactionRecord): void {
  if (!tx.kind) {
    throw new TreasuryValidationError("KIND_REQUIRED", "classification requires kind");
  }
  if (tx.accountingAmountMicros === null) {
    throw new TreasuryValidationError(
      "ACCOUNTING_AMOUNT_REQUIRED",
      "classification requires accounting_amount_micros",
    );
  }
  if (
    tx.accountingDenominationPolicy !== USDT_NOMINAL_USD_POLICY_V1 &&
    tx.accountingDenominationPolicy !== MANUAL_ACCOUNTING_CURRENCY_V1
  ) {
    throw new TreasuryValidationError(
      "DENOMINATION_POLICY_REQUIRED",
      `v1 requires ${USDT_NOMINAL_USD_POLICY_V1} or ${MANUAL_ACCOUNTING_CURRENCY_V1}`,
    );
  }
  const approvedManualUsd = tx.provenance === "MANUAL" && isApprovedManualUsdAsset(tx);
  if (!isApprovedV1UsdtAsset(tx) && !approvedManualUsd) {
    throw new TreasuryValidationError(
      "ASSET_POLICY_REQUIRED",
      "v1 qualifying accounting requires approved USDT nominal policy or a manual USD entry",
    );
  }
  const expected = computeCanonicalCashEffect({
    kind: tx.kind,
    direction: tx.direction,
    accountingAmountMicros: tx.accountingAmountMicros,
    signedCashEffectMicros: tx.cashEffectMicros ?? undefined,
  });
  if (tx.cashEffectMicros === null || tx.cashEffectMicros !== expected.cashEffectMicros) {
    throw new TreasuryValidationError(
      "CASH_EFFECT_INCONSISTENT",
      "cash_effect_micros must match the canonical engine",
    );
  }
}

export function assertReadyToVerify(input: {
  tx: TreasuryTransactionRecord;
  linkedObservations: readonly TreasuryObservationRecord[];
  evidenceLinks: readonly TreasuryEvidenceLinkRecord[];
}): void {
  if (input.tx.status === "REJECTED" || input.tx.status === "DUPLICATE") {
    throw new TreasuryValidationError(
      "TERMINAL_STATUS",
      `${input.tx.status} is terminal and cannot become VERIFIED`,
    );
  }
  assertClassifiedSemanticFields(input.tx);
  assertWatcherVerifiedPrecondition({
    provenance: input.tx.provenance,
    linkedObservations: input.linkedObservations,
  });
  if (
    input.tx.kind &&
    EVIDENCE_REQUIRED_KINDS.has(input.tx.kind) &&
    input.evidenceLinks.length < 1
  ) {
    throw new TreasuryValidationError(
      "EVIDENCE_REQUIRED",
      `${input.tx.kind} requires evidence before VERIFIED`,
    );
  }
  if (input.tx.budgetId && input.tx.organizationId.length === 0) {
    throw new TreasuryValidationError("CROSS_ORG_REFERENCE", "budget reference requires org scope");
  }
}
