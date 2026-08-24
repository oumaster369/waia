import { describe, expect, it } from "vitest";

import {
  assertInformationAcquisitionSelectionV1,
  assertInformationInquiryPolicyV1,
  canonicalizeInformationNeedTimeframeRequirementsV1,
  computeInformationContradictionMaterialityEvaluationDigestV1,
  defineInformationAcquisitionSelectionV1,
  defineInformationInquiryPolicyV1,
  inquiryCanonicalJsonString,
  mapInformationInquiryPurposeV1,
  type InformationNeedV1,
  type InformationInquiryPolicyV1,
} from "@/lib/trader/intelligence/information-inquiry";

const D = "a".repeat(64);
const E = "b".repeat(64);

function policyInput(
  overrides: Partial<{
    purpose: "NEW_OPPORTUNITY_SEARCH" | "OPEN_POSITION_REASSESSMENT" | "RESEARCH";
    assignments: InformationInquiryPolicyV1["costPolicy"]["assignments"];
  }> = {},
) {
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
      assignments: overrides.assignments ?? [
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
  it("binds contradiction materiality to exact evidence and pinned policy identity", () => {
    const input = {
      claimId: "claim-price-state",
      materiality: "MATERIAL" as const,
      evidenceIds: ["evidence-a", "evidence-b"],
      observationIds: ["obs-a", "obs-b"],
      observationContentDigests: [
        { observationId: "obs-a", observationContentDigest: D },
        { observationId: "obs-b", observationContentDigest: E },
      ],
      observationContradictionStates: [
        { observationId: "obs-a", contradiction: "SUPPORTS" as const },
        { observationId: "obs-b", contradiction: "CONTRADICTS" as const },
      ],
      providerIds: ["binance_spot", "htx_spot"],
      dependenceGroups: ["independent-a", "independent-b"],
      materialityPolicyVersion: "contradiction-v1",
      materialityPolicyContentDigest: E,
    };
    const digest = computeInformationContradictionMaterialityEvaluationDigestV1(input);
    expect(digest).toHaveLength(64);
    expect(
      computeInformationContradictionMaterialityEvaluationDigestV1({
        ...input,
        materiality: "IMMATERIAL",
      }),
    ).not.toBe(digest);
    expect(() =>
      computeInformationContradictionMaterialityEvaluationDigestV1({
        ...input,
        observationContentDigests: [input.observationContentDigests[0]],
      }),
    ).toThrow("contradictionObservationDigestIdentity");
  });

  it("maps the three inquiry purposes exactly onto DEE-621 purposes", () => {
    expect(mapInformationInquiryPurposeV1("NEW_OPPORTUNITY_SEARCH")).toBe("NEW_OPPORTUNITY");
    expect(mapInformationInquiryPurposeV1("OPEN_POSITION_REASSESSMENT")).toBe(
      "OPEN_POSITION_REASSESSMENT",
    );
    expect(mapInformationInquiryPurposeV1("RESEARCH")).toBe("RESEARCH_NON_CAPITAL");
    expect(() => mapInformationInquiryPurposeV1("NEW_OPPORTUNITY" as never)).toThrow("purpose");
    expect(inquiryCanonicalJsonString({ ä: 1, z: 2 })).toBe('{"z":2,"ä":1}');
  });

  it("preserves caller-supplied freshness independently for every required timeframe", () => {
    const need = {
      id: "need-price",
      requirementId: "r-price",
      questionId: "Q_WHAT_HAPPENING",
      classification: "MANDATORY",
      evidenceFamily: "PRICE_STATE",
      allowedObservationKinds: ["ohlcv_bar"],
      allowedObservationSchemaVersions: ["ohlcv_bar/v1"],
      timeframeRequirements: canonicalizeInformationNeedTimeframeRequirementsV1([
        { timeframe: "1h", maxStalenessMs: 15_000 },
        { timeframe: "4h", maxStalenessMs: 60_000 },
      ]),
      inquiryBounds: { maxDepth: 2, maxDurationMs: 5_000, maxProviderFanout: 1 },
      providerCandidates: [{ providerId: "htx_spot", substitutionRuleId: null, costUnits: 1 }],
      requirePitQualified: true,
      requireReplayEligible: true,
      contradiction: null,
      reasonCodes: ["PRICE_REQUIRED"],
    } as const satisfies InformationNeedV1;
    expect(need.timeframeRequirements).toEqual([
      { timeframe: "4h", maxStalenessMs: 60_000 },
      { timeframe: "1h", maxStalenessMs: 15_000 },
    ]);
    expect(Object.isFrozen(need.timeframeRequirements)).toBe(true);
    expect(() =>
      canonicalizeInformationNeedTimeframeRequirementsV1([
        { timeframe: "1h", maxStalenessMs: 15_000 },
        { timeframe: "1h", maxStalenessMs: 30_000 },
      ]),
    ).toThrow("duplicateNeedTimeframe");
    expect(() =>
      canonicalizeInformationNeedTimeframeRequirementsV1([{ timeframe: "1h", maxStalenessMs: -1 }]),
    ).toThrow("needMaxStalenessMs");
    expect(() => canonicalizeInformationNeedTimeframeRequirementsV1([])).toThrow(
      "needTimeframeRequirements",
    );
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
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.bounds)).toBe(true);
    expect(Object.isFrozen(left.timeframePolicies[0])).toBe(true);
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
    expect(() =>
      defineInformationInquiryPolicyV1({
        ...policyInput(),
        timeframePolicies: policyInput().timeframePolicies.map((entry) =>
          entry.timeframe === "1m"
            ? { ...entry, maxStalenessMsByRequirement: entry.maxStalenessMsByRequirement.slice(1) }
            : entry,
        ),
      }),
    ).toThrow("incompleteStalenessRequirements");
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
    expect(Object.isFrozen(selection.requestedSources[0])).toBe(true);
    expect(Object.isFrozen(selection.requestedSources[0]?.allowedObservationKinds)).toBe(true);
    expect(assertInformationAcquisitionSelectionV1(selection)).toBe(selection);
    expect(() =>
      assertInformationAcquisitionSelectionV1({
        ...selection,
        organizationId: "org-2",
      }),
    ).toThrow("selectionIdentity");
    expect(() =>
      defineInformationAcquisitionSelectionV1({
        ...input,
        requestedSources: [
          { ...input.requestedSources[0]!, allowedObservationKinds: ["quote_l1", "quote_l1"] },
        ],
      }),
    ).toThrow("allowedObservationKinds");
    expect(() =>
      defineInformationAcquisitionSelectionV1({
        ...input,
        requestedSources: [
          {
            ...input.requestedSources[0]!,
            allowedObservationKinds: ["cross_exchange_confirmation"],
          },
        ],
      } as never),
    ).toThrow("allowedObservationKinds");
    expect(() =>
      defineInformationAcquisitionSelectionV1({
        ...input,
        requestedSources: [input.requestedSources[0]!, input.requestedSources[0]!],
      }),
    ).toThrow("duplicateRequestedSource");
  });

  it("strips unknown authority fields and rejects them on asserted identities", () => {
    const input = policyInput() as ReturnType<typeof policyInput> & {
      formula?: string;
      bounds: ReturnType<typeof policyInput>["bounds"] & { capitalAuthority?: boolean };
    };
    input.formula = "forbidden";
    input.bounds.capitalAuthority = true;
    const sealed = defineInformationInquiryPolicyV1(input);
    expect("formula" in sealed).toBe(false);
    expect("capitalAuthority" in sealed.bounds).toBe(false);
    expect(() => assertInformationInquiryPolicyV1({ ...sealed, futurePnl: 7 } as never)).toThrow(
      "policyIdentity",
    );
  });
});
