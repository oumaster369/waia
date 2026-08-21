import { describe, expect, it } from "vitest";

import { calculateRiskAdmissionV2 } from "@/lib/trader/risk/v2/risk-admission-service-v2";
import {
  createRiskAllowanceV2,
  validateRiskAllowanceV2,
} from "@/lib/trader/risk/v2/risk-allowance-v2";

const digest = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

function allowance() {
  return createRiskAllowanceV2({
    riskAllowanceId: "00000000-0000-4000-8000-000000065001",
    organizationId: "00000000-0000-4000-8000-000000065002",
    accountId: "spot-main",
    venue: "HTX",
    market: "SPOT",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    instrumentIdentityDigestHex: digest("1"),
    riskVerdictId: "00000000-0000-4000-8000-000000065003",
    riskVerdictContentDigestHex: digest("2"),
    admissionSequence: "7",
    decision: {
      decisionId: "decision-7",
      semanticDigestHex: digest("3"),
      contentDigestHex: digest("4"),
      action: "ENTER_LONG",
      economicSizeSetId: "size-set-7",
      economicSizeSetDigestHex: digest("5"),
    },
    riskPolicyVersion: "risk-v2-test",
    riskPolicyDigestHex: digest("6"),
    realitySnapshotId: "reality-7",
    realityContentDigestHex: digest("7"),
    reconciliationAuthorityDigestHex: digest("8"),
    postureAtIssuance: "NORMAL",
    strictExposureReduction: false,
    exactQualifiedQuantity: "0.1",
    reservedExposureNotional: "2500",
    nonce: "00000000-0000-4000-8000-000000065004",
    issuedAtUtc: "2026-08-21T00:00:00.000Z",
    validUntilUtc: "2026-08-21T00:00:30.000Z",
  });
}

describe("RiskAllowanceV2", () => {
  it("seals exact Decision/Risk/Reality/policy bindings and is immutable", () => {
    const value = allowance();
    expect(validateRiskAllowanceV2(value)).toBe(true);
    expect(value).toMatchObject({ lifecycleState: "ISSUED", exactQualifiedQuantity: "0.1" });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.decision)).toBe(true);
  });

  it("rejects expired-at-issue, HALT/KILLED, and invalid CLOSE_ONLY authority", () => {
    const valid = allowance();
    const { schemaVersion: _schema, lifecycleState: _state, semanticDigestHex: _semantic,
      contentDigestHex: _content, ...draft } = valid;
    void _schema;
    void _state;
    void _semantic;
    void _content;
    expect(() => createRiskAllowanceV2({ ...draft, validUntilUtc: draft.issuedAtUtc })).toThrow();
    expect(() => createRiskAllowanceV2({ ...draft, postureAtIssuance: "HALT" })).toThrow();
    expect(() => createRiskAllowanceV2({
      ...draft,
      postureAtIssuance: "CLOSE_ONLY",
      strictExposureReduction: false,
    })).toThrow();
  });

  it("accounts for reconciled, worst-case pending, and outstanding reservations", () => {
    expect(calculateRiskAdmissionV2({
      accounting: {
        reconciledExposureNotional: "40",
        worstCasePendingExposureNotional: "20",
        outstandingReservationNotional: "10",
        exposureLimitNotional: "100",
      },
      requestedReservationNotional: "25",
      posture: "NORMAL",
      strictExposureReduction: false,
      reconciliationStatus: "RECONCILED",
    })).toEqual({
      status: "ADMITTED",
      reservationNotional: "25",
      remainingBeforeAdmissionNotional: "30",
      remainingAfterAdmissionNotional: "5",
    });
  });

  it("refuses cap contention and fail-closed posture/reconciliation", () => {
    const accounting = {
      reconciledExposureNotional: "40",
      worstCasePendingExposureNotional: "20",
      outstandingReservationNotional: "10",
      exposureLimitNotional: "100",
    };
    expect(calculateRiskAdmissionV2({
      accounting,
      requestedReservationNotional: "31",
      posture: "NORMAL",
      strictExposureReduction: false,
      reconciliationStatus: "RECONCILED",
    })).toMatchObject({ status: "REFUSED", reason: "RESERVATION_EXCEEDS_REMAINING_ENVELOPE" });
    expect(calculateRiskAdmissionV2({
      accounting,
      requestedReservationNotional: "0",
      posture: "KILLED",
      strictExposureReduction: true,
      reconciliationStatus: "RECONCILED",
    })).toMatchObject({ status: "REFUSED", reason: "POSTURE_REFUSED" });
    expect(calculateRiskAdmissionV2({
      accounting,
      requestedReservationNotional: "0",
      posture: "CLOSE_ONLY",
      strictExposureReduction: true,
      reconciliationStatus: "STALE",
    })).toMatchObject({ status: "REFUSED", reason: "RECONCILIATION_NOT_CURRENT" });
  });
});
