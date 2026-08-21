import { describe, expect, it } from "vitest";

import {
  createContinuousEconomicAdmissibleSizeSetV2,
  createDiscreteEconomicAdmissibleSizeSetV2,
  intersectEconomicAdmissibleSizeSetV2,
} from "@/lib/trader/risk/v2/economic-size-intersection-v2";
import {
  CANONICAL_RISK_VERDICTS_V2,
  createRiskVerdictV2,
  mapLegacyRiskOutcomeToV2,
  validateRiskVerdictV2,
  type RiskVerdictV2Draft,
} from "@/lib/trader/risk/v2/risk-verdict-contract-v2";

const digest = (character: string) => character.repeat(64);
const authority = {
  sizeSetId: "decision-size-set",
  organizationId: "org-a",
  accountId: "account-a",
  instrumentIdentityDigestHex: digest("a"),
  decisionContentDigestHex: digest("b"),
  authorityReceiptDigestHex: digest("c"),
};

function verdictDraft(overrides: Partial<RiskVerdictV2Draft> = {}): RiskVerdictV2Draft {
  return {
    riskVerdictId: "verdict-a",
    organizationId: "org-a",
    accountId: "account-a",
    venue: "htx",
    market: "SPOT",
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    instrumentIdentityDigestHex: digest("a"),
    decision: {
      decisionId: "decision-a",
      semanticDigestHex: digest("b"),
      contentDigestHex: digest("c"),
      action: "ENTER_LONG",
      economicSizeSetId: "decision-size-set",
      economicSizeSetDigestHex: digest("d"),
    },
    riskPolicyVersion: "risk-policy/v2",
    riskPolicyDigestHex: digest("e"),
    limitVersions: [
      { layer: "L3", version: "global/v1", digestHex: digest("f") },
      { layer: "L0", version: "validation/v1", digestHex: digest("1") },
    ],
    reality: {
      snapshotId: "reality-a",
      contentDigestHex: digest("2"),
      asOfUtc: "2026-08-21T08:00:00.000Z",
      reconciliationAuthorityDigestHex: digest("3"),
      reconciliationStatus: "RECONCILED",
    },
    referencePrice: {
      authorityId: "median-mark-a",
      authorityVersion: "median-mark/v1",
      contentDigestHex: digest("4"),
      price: "100000",
    },
    admissionSequence: "1",
    verdict: "APPROVE_CLAMPED",
    approvedQualifiedQuantity: "0.025",
    bindingLayers: ["L3", "L0", "L3"],
    reasonCodes: ["RISK_MAX_NOTIONAL_EXCEEDED", "RISK_MAX_NOTIONAL_EXCEEDED"],
    issuedAtUtc: "2026-08-21T08:00:00.001Z",
    ...overrides,
  };
}

describe("Risk V2 contract (DEE-663)", () => {
  it("maps every legacy outcome without claiming a history rewrite", () => {
    const legacy = ["APPROVE", "RESIZE", "REJECT", "CLOSE_ONLY", "STOP_ACCOUNT"] as const;
    expect(legacy.map((outcome) => mapLegacyRiskOutcomeToV2(outcome))).toEqual([
      expect.objectContaining({ sourceOutcome: "APPROVE", canonicalVerdict: "APPROVE" }),
      expect.objectContaining({ sourceOutcome: "RESIZE", canonicalVerdict: "APPROVE_CLAMPED" }),
      expect.objectContaining({ sourceOutcome: "REJECT", canonicalVerdict: "VETO" }),
      expect.objectContaining({ sourceOutcome: "CLOSE_ONLY", canonicalVerdict: "CLOSE_ONLY" }),
      expect.objectContaining({ sourceOutcome: "STOP_ACCOUNT", canonicalVerdict: "HALT" }),
    ]);
    expect(legacy.every((outcome) => mapLegacyRiskOutcomeToV2(outcome).preservesHistoricalRecord)).toBe(true);
    expect(CANONICAL_RISK_VERDICTS_V2).toEqual([
      "APPROVE", "APPROVE_CLAMPED", "VETO", "CLOSE_ONLY", "HALT",
    ]);
  });

  it("seals an immutable, canonical and causally sensitive verdict", () => {
    const first = createRiskVerdictV2(verdictDraft());
    const replay = createRiskVerdictV2(verdictDraft({
      bindingLayers: ["L0", "L3"],
      reasonCodes: ["RISK_MAX_NOTIONAL_EXCEEDED"],
    }));
    expect(replay).toEqual(first);
    expect(validateRiskVerdictV2(first)).toBe(true);
    expect(first.bindingLayers).toEqual(["L0", "L3"]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.decision)).toBe(true);
    expect(Object.isFrozen(first.limitVersions)).toBe(true);

    const changedDecision = createRiskVerdictV2(verdictDraft({
      decision: { ...verdictDraft().decision, contentDigestHex: digest("9") },
    }));
    expect(changedDecision.semanticDigestHex).not.toBe(first.semanticDigestHex);
    expect(changedDecision.contentDigestHex).not.toBe(first.contentDigestHex);

    const differentRecordTime = createRiskVerdictV2(verdictDraft({
      riskVerdictId: "verdict-b",
      issuedAtUtc: "2026-08-21T08:00:00.002Z",
    }));
    expect(differentRecordTime.semanticDigestHex).toBe(first.semanticDigestHex);
    expect(differentRecordTime.contentDigestHex).not.toBe(first.contentDigestHex);
  });

  it("fails closed on verdict/quantity and reason inconsistencies", () => {
    expect(() => createRiskVerdictV2(verdictDraft({ verdict: "HALT" }))).toThrow(/quantity mismatch/);
    expect(() => createRiskVerdictV2(verdictDraft({
      verdict: "VETO", approvedQualifiedQuantity: null, reasonCodes: [],
    }))).toThrow(/requires reason codes/);
    expect(() => createRiskVerdictV2(verdictDraft({ admissionSequence: "0" }))).toThrow(/sequence/);
  });

  it("intersects continuous bounds exactly without assuming smaller is economically valid", () => {
    const interval = createContinuousEconomicAdmissibleSizeSetV2({
      ...authority,
      minimumQuantity: "1000",
      maximumQuantity: "5000",
    });
    expect(intersectEconomicAdmissibleSizeSetV2({ economicSizeSet: interval, riskCapQuantity: "3000" }))
      .toEqual({ status: "PERMITTED", approvedQuantity: "3000", disposition: "CLAMPED_WITHIN_QUALIFIED_SET" });
    expect(intersectEconomicAdmissibleSizeSetV2({ economicSizeSet: interval, riskCapQuantity: "5000" }))
      .toEqual({ status: "PERMITTED", approvedQuantity: "5000", disposition: "AS_PROPOSED" });
    expect(intersectEconomicAdmissibleSizeSetV2({ economicSizeSet: interval, riskCapQuantity: "999.99999999" }))
      .toMatchObject({ status: "EMPTY", approvedQuantity: null });
  });

  it("selects only an exact discrete member and never invents the cap", () => {
    const discrete = createDiscreteEconomicAdmissibleSizeSetV2({
      ...authority,
      exactQuantities: ["5000", "1000", "2500"],
    });
    expect(discrete.exactQuantities).toEqual(["1000", "2500", "5000"]);
    expect(intersectEconomicAdmissibleSizeSetV2({ economicSizeSet: discrete, riskCapQuantity: "3000" }))
      .toEqual({ status: "PERMITTED", approvedQuantity: "2500", disposition: "CLAMPED_WITHIN_QUALIFIED_SET" });
    expect(intersectEconomicAdmissibleSizeSetV2({ economicSizeSet: discrete, riskCapQuantity: "999" }))
      .toMatchObject({ status: "EMPTY", disposition: "DECISION_REEVALUATION_OR_VETO_REQUIRED" });
  });

  it("fails closed on malformed size authority or cap", () => {
    const discrete = createDiscreteEconomicAdmissibleSizeSetV2({ ...authority, exactQuantities: ["1"] });
    expect(intersectEconomicAdmissibleSizeSetV2({
      economicSizeSet: { ...discrete, contentDigestHex: digest("0") },
      riskCapQuantity: "1",
    })).toMatchObject({ status: "INVALID", reasonCode: "ECONOMIC_SIZE_AUTHORITY_INVALID" });
    expect(intersectEconomicAdmissibleSizeSetV2({ economicSizeSet: discrete, riskCapQuantity: "0" }))
      .toMatchObject({ status: "INVALID", reasonCode: "RISK_CAP_INVALID" });
    expect(() => createDiscreteEconomicAdmissibleSizeSetV2({
      ...authority, exactQuantities: ["1", "1.00000000"],
    })).toThrow(/unique/);
  });
});
