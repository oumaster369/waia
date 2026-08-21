import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import type { ProtectivePostureV2 } from "./protective-posture-v2";
import { evaluateProtectivePosturePermissionV2 } from "./protective-posture-v2";

export type RiskAccountAccountingV2 = Readonly<{
  reconciledExposureNotional: string;
  worstCasePendingExposureNotional: string;
  outstandingReservationNotional: string;
  exposureLimitNotional: string;
}>;

export type RiskAdmissionCalculationV2 =
  | Readonly<{
      status: "ADMITTED";
      reservationNotional: string;
      remainingBeforeAdmissionNotional: string;
      remainingAfterAdmissionNotional: string;
    }>
  | Readonly<{
      status: "REFUSED";
      reservationNotional: null;
      remainingBeforeAdmissionNotional: string;
      remainingAfterAdmissionNotional: string;
      reason:
        | "RECONCILIATION_NOT_CURRENT"
        | "POSTURE_REFUSED"
        | "RESERVATION_EXCEEDS_REMAINING_ENVELOPE"
        | "ACCOUNTING_INVALID";
    }>;

function canonicalNonnegative(value: string): string {
  const parsed = parseDecimal(value);
  if (parsed < 0n) throw new Error("accounting values must be nonnegative");
  return formatDecimal(parsed);
}

export function computeRiskAccountRemainingNotionalV2(
  input: RiskAccountAccountingV2,
): string {
  const limit = parseDecimal(canonicalNonnegative(input.exposureLimitNotional));
  const used =
    parseDecimal(canonicalNonnegative(input.reconciledExposureNotional)) +
    parseDecimal(canonicalNonnegative(input.worstCasePendingExposureNotional)) +
    parseDecimal(canonicalNonnegative(input.outstandingReservationNotional));
  return formatDecimal(limit > used ? limit - used : 0n);
}

export function calculateRiskAdmissionV2(input: {
  accounting: RiskAccountAccountingV2;
  requestedReservationNotional: string;
  posture: ProtectivePostureV2;
  strictExposureReduction: boolean;
  reconciliationStatus: "RECONCILED" | "DIVERGENT" | "UNAVAILABLE" | "STALE";
}): RiskAdmissionCalculationV2 {
  let reservation: string;
  let remaining: string;
  try {
    reservation = canonicalNonnegative(input.requestedReservationNotional);
    remaining = computeRiskAccountRemainingNotionalV2(input.accounting);
  } catch {
    return {
      status: "REFUSED",
      reservationNotional: null,
      remainingBeforeAdmissionNotional: "0",
      remainingAfterAdmissionNotional: "0",
      reason: "ACCOUNTING_INVALID",
    };
  }
  if (input.reconciliationStatus !== "RECONCILED") {
    return {
      status: "REFUSED",
      reservationNotional: null,
      remainingBeforeAdmissionNotional: remaining,
      remainingAfterAdmissionNotional: remaining,
      reason: "RECONCILIATION_NOT_CURRENT",
    };
  }
  const posture = evaluateProtectivePosturePermissionV2({
    posture: input.posture,
    actionIsStrictExposureReduction: input.strictExposureReduction,
  });
  if (posture.consumptionDisposition === "REFUSE") {
    return {
      status: "REFUSED",
      reservationNotional: null,
      remainingBeforeAdmissionNotional: remaining,
      remainingAfterAdmissionNotional: remaining,
      reason: "POSTURE_REFUSED",
    };
  }
  if (compareDecimal(reservation, remaining) > 0) {
    return {
      status: "REFUSED",
      reservationNotional: null,
      remainingBeforeAdmissionNotional: remaining,
      remainingAfterAdmissionNotional: remaining,
      reason: "RESERVATION_EXCEEDS_REMAINING_ENVELOPE",
    };
  }
  return {
    status: "ADMITTED",
    reservationNotional: reservation,
    remainingBeforeAdmissionNotional: remaining,
    remainingAfterAdmissionNotional: formatDecimal(
      parseDecimal(remaining) - parseDecimal(reservation),
    ),
  };
}
