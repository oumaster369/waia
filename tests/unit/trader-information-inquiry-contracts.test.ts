import { describe, expect, it } from "vitest";

import {
  assertInformationAcquisitionSelectionV1,
  assertInformationInquiryPolicyV1,
  defineInformationAcquisitionSelectionV1,
  defineInformationInquiryPolicyV1,
  mapInformationInquiryPurposeV1,
  type InformationInquiryPolicyV1,
} from "@/lib/trader/intelligence/information-inquiry";

const D = "a".repeat(64);
const E = "b".repeat(64);

function policyInput(overrides: Partial<{
  purpose: "NEW_OPPORTUNITY_SEARCH" | "OPEN_POSITION_REASSESSMENT" | "RESEARCH";
  assignments: InformationInquiryPolicyV1["costPolicy"]["assignments"];
}> = {}) {
  return {
    policyVersion: "policy-v1",
    purpose: overrides.purpose ?? ("NEW_OPPORTUNITY_SEARCH" as const),
    timeframePolicies: ["1m", "1d", "15m", "4h", "1h"].map((timeframe) => ({
      timeframe: timeframe as "1d" | "4h" | "1h" | "15m" | "1m",
      relevantRequirementIds: timeframe === "1m" ? ["r-liquidity", "r-price"] : ["r-price"],
      maxStalenessMsByRequirement:
        timeframe === "1m"
          ? [
              { requirementId: "r-price", maxStalenessMs: 1_000 },
              { requirementId: "r-liquidity", maxStalenessMs: 500 },
            ]
          : [{ requirementId: "r-price", maxStalenessMs: 60_000 }],
    })),
    bounds: {
      maxIterations: 3,
      maxDepth: 2,
      maxDurationMs: 5_000,
      maxProviderFanout: 2,
      maxQueryCount: 4,
      maxHistoricalResults: 6,
      maxAcquisitionCostUnits: 10,
    },
    costPolicy: {
      evaluatorVersion: "fixed-policy-assignments-v1",
      evaluatorContentDigest: D,
      assignments:
        overrides.assignments ??
        [
          { requirementId: "r-price", providerId: "htx_spot", costUnits: 1 },
          { requirementId: "r-liquidity", providerId: "htx_spot", costUnits: 2 },
        ],
    },
    contradictionMaterialityPolicyVersion: "contradiction-v1",
    contradictionMaterialityPolicyDigest: E,
    schedulingPolicyVersion: "scheduler-v1",
    schedulingPolicyDigest: D,
    maxNewOpportunityWaitTurns: 2,
  };
}

describe("DEE-696 information inquiry contracts", () => {
  it("maps the three inquiry purposes exactly onto DEE-621 purposes", () => {
    expect(mapInformationInquiryPurposeV1("NEW_OPPORTUNITY_SEARCH")).toBe("NEW_OPPORTUNITY");
    expect(mapInformationInquiryPurposeV1("OPEN_POSITION_REASSESSMENT")).toBe(
      "OPEN_POSITION_REASSESSMENT",
    );
    expect(mapInformationInquiryPurposeV1("RESEARCH")).toBe("RESEARCH_NON_CAPITAL");
    expect(() => mapInformationInquiryPurposeV1("NEW_OPPORTUNITY" as never)).toThrow("purpose");
  });

  it("seals a caller-valued policy deterministically without defaults", () => {
    const left = defineInformationInquiryPolicyV1(policyInput());
    const right = defineInformationInquiryPolicyV1({
      ...policyInput(),
      timeframePolicies: [...policyInput().timeframePolicies].reverse(),
      costPolicy: {
        ...policyInput().costPolicy,
        assignments: [...policyInput().costPolicy.assignments].reverse(),
      },
    });
    expect(left).toEqual(right);
    expect(left.timeframePolicies.map((entry) => entry.timeframe)).toEqual([
      "1d",
      "4h",
      "1h",
      "15m",
      "1m",
    ]);
    expect(left.authority).toBe("EVIDENCE_ACQUISITION_POLICY_ONLY");
    expect(assertInformationInquiryPolicyV1(left)).toBe(left);
  });

  it("binds exact cost attribution into identity and rejects missing/forged policy values", () => {
    const one = defineInformationInquiryPolicyV1(policyInput());
    const changed = defineInformationInquiryPolicyV1(
      policyInput({
        assignments: [
          { requirementId: "r-price", providerId: "htx_spot", costUnits: 2 },
          { requirementId: "r-liquidity", providerId: "htx_spot", costUnits: 2 },
        ],
      }),
    );
    expect(changed.contentDigest).not.toBe(one.contentDigest);
    expect(() =>
      defineInformationInquiryPolicyV1({
        ...policyInput(),
        costPolicy: { ...policyInput().costPolicy, assignments: [] },
      }),
    ).not.toThrow();
    expect(() =>
      assertInformationInquiryPolicyV1({ ...one, contentDigest: "f".repeat(64) }),
    ).toThrow("policyIdentity");
    expect(() =>
      defineInformationInquiryPolicyV1({
        ...policyInput(),
        timeframePolicies: policyInput().timeframePolicies.slice(1),
      }),
    ).toThrow("timeframePolicy");
  });

  it("seals exact plan-derived live/historical selections and rejects forged identities", () => {
    const input = {
      planId: `inp_${D}`,
      planContentDigest: D,
      organizationId: "org-1",
      accountId: "account-1",
      symbol: "BTC/USDT",
      pitAnchor: "2026-08-24T12:00:00.000Z",
      purpose: "NEW_OPPORTUNITY_SEARCH" as const,
      mode: "LIVE" as const,
      requestedSources: [
        {
          needId: "need-price",
          requirementId: "r-price",
          providerId: "htx_spot",
          allowedObservationKinds: ["quote_l1", "ohlcv_bar"] as const,
          costUnits: 1,
          reasonCodes: ["PRICE_REQUIRED"],
        },
      ],
    };
    const selection = defineInformationAcquisitionSelectionV1(input);
    expect(selection.authority).toBe("EVIDENCE_ACQUISITION_ONLY");
    expect(selection.requestedSources[0]?.allowedObservationKinds).toEqual([
      "ohlcv_bar",
      "quote_l1",
    ]);
    expect(assertInformationAcquisitionSelectionV1(selection)).toBe(selection);
    expect(() =>
      assertInformationAcquisitionSelectionV1({
        ...selection,
        organizationId: "org-2",
      }),
    ).toThrow("selectionIdentity");
  });
});
