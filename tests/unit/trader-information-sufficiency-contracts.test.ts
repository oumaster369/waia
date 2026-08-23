import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
  type InformationQuestionRequirementV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";

const HEX = (value: string) => createHash("sha256").update(value).digest("hex");
const PIT = "2026-08-23T12:00:00.000Z";

function requirement(
  overrides: Partial<InformationQuestionRequirementV2> = {},
): InformationQuestionRequirementV2 {
  return {
    id: "price-state",
    questionId: "Q_WHAT_HAPPENING",
    classification: "MANDATORY",
    contextTriggerKey: null,
    satisfiers: [{ evidenceFamily: "price", providerIds: ["htx_spot"], substitutionRuleId: null }],
    allowedObservationKinds: ["ohlcv_bar"],
    allowedObservationSchemaVersions: [CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION],
    allowedMeasurementDefinitionDigests: [],
    maxStalenessMs: 60_000,
    minimumTrustScore: 0.5,
    minimumIndependentGroups: 1,
    contradictionPolicy: "FAIL_UNRESOLVED",
    requirePitQualified: true,
    requireReplayEligible: true,
    inquiryBounds: { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 2 },
    ...overrides,
  };
}

function profile(requirements: readonly InformationQuestionRequirementV2[] = [requirement()]) {
  return defineRequiredInformationProfileV2({
    organizationId: "org-a",
    accountId: "account-a",
    profileVersion: "profile-test-v1",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    forecastPackageId: null,
    forecastPackageContentDigest: null,
    inputContractContentDigest: null,
    requirements,
    aggregateQualityContract: null,
  });
}

function evidence(overrides: Partial<InformationEvidenceV2> = {}): InformationEvidenceV2 {
  return {
    evidenceId: "evidence-price-1",
    evidenceFamily: "price",
    providerId: "htx_spot",
    sourceId: "00000000-0000-4000-8000-000000000001",
    observationId: "00000000-0000-4000-8000-000000000002",
    observationKind: "ohlcv_bar",
    observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    observationContentDigest: HEX("observation"),
    trustAsOfReceiptId: HEX("trust-receipt"),
    trustRevisionId: "00000000-0000-4000-8000-000000000003",
    trustRevisionContentDigest: HEX("trust-revision"),
    measurementDefinitionId: null,
    measurementDefinitionContentDigest: null,
    measurementValueId: null,
    measurementValueContentDigest: null,
    availability: "AVAILABLE",
    availableAt: "2026-08-23T11:59:30.000Z",
    trust: "TRUSTED",
    trustScore: 0.9,
    pitQualified: true,
    replayEligible: true,
    dependenceGroup: "htx-price",
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "PRICE_STATE",
    historyScope: "NOT_HISTORICAL",
    degradationReasonCodes: [],
    ...overrides,
  };
}

function evaluate(
  selectedProfile: ReturnType<typeof profile>,
  selectedEvidence: readonly InformationEvidenceV2[],
  overrides: Partial<Parameters<typeof evaluateInformationSufficiencyV2>[0]> = {},
) {
  return evaluateInformationSufficiencyV2({
    profile: selectedProfile,
    organizationId: "org-a",
    accountId: "account-a",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    pitAnchor: PIT,
    activeContextTriggers: [],
    evidence: selectedEvidence,
    ...overrides,
  });
}

describe("DEE-686 Required Information Profile V2 contracts", () => {
  it("builds deterministic immutable profile and receipt identities without formula authority", () => {
    const selected = profile();
    const first = evaluate(selected, [evidence()]);
    const second = evaluate(selected, [evidence()]);

    expect(first).toEqual(second);
    expect(first.status).toBe("SUFFICIENT");
    expect(first.id).toBe(first.contentDigest);
    expect(selected.id).toBe(selected.contentDigest);
    expect(selected.authority).toBe("EPISTEMIC_PREREQUISITE_ONLY");
    expect(selected).not.toHaveProperty("formula");
    expect(first).not.toHaveProperty("forecast");
    expect(first).not.toHaveProperty("decision");
    expect(first).not.toHaveProperty("riskApproval");
  });

  it("does not let healthy optional evidence compensate for a missing mandatory hard floor", () => {
    const selected = profile([
      requirement(),
      requirement({
        id: "optional-news",
        questionId: "Q_WHY_HAPPENING",
        classification: "OPTIONAL_ENRICHMENT",
        satisfiers: [{ evidenceFamily: "news", providerIds: [], substitutionRuleId: null }],
        allowedObservationKinds: ["news_headline"],
        minimumTrustScore: null,
      }),
    ]);
    const receipt = evaluate(selected, [
      evidence({
        evidenceId: "news-1",
        evidenceFamily: "news",
        providerId: "coindesk_rss",
        observationKind: "news_headline",
        epistemicRole: "CAUSAL",
      }),
    ]);

    expect(receipt.status).toBe("UNAVAILABLE");
    expect(
      receipt.requirementReceipts.find((entry) => entry.requirementId === "price-state"),
    ).toMatchObject({
      terminalStatus: "UNAVAILABLE",
      blocking: true,
    });
  });

  it("keeps missing optional evidence non-blocking and inactive context requirements NOT_REQUIRED", () => {
    const selected = profile([
      requirement(),
      requirement({
        id: "optional-news",
        questionId: "Q_WHY_HAPPENING",
        classification: "OPTIONAL_ENRICHMENT",
        satisfiers: [{ evidenceFamily: "news", providerIds: [], substitutionRuleId: null }],
        allowedObservationKinds: ["news_headline"],
      }),
      requirement({
        id: "context-liquidity",
        questionId: "Q_EXECUTION_LIQUIDITY",
        classification: "CONTEXT_TRIGGERED",
        contextTriggerKey: "EXECUTION_NEAR",
      }),
    ]);
    const receipt = evaluate(selected, [evidence()]);

    expect(receipt.status).toBe("SUFFICIENT");
    expect(
      receipt.requirementReceipts.find((entry) => entry.requirementId === "optional-news"),
    ).toMatchObject({
      terminalStatus: "INSUFFICIENT_NON_BLOCKING",
      blocking: false,
    });
    expect(
      receipt.requirementReceipts.find((entry) => entry.requirementId === "context-liquidity"),
    ).toMatchObject({
      terminalStatus: "NOT_REQUIRED",
      active: false,
    });
  });

  it.each([
    ["stale", evidence({ availableAt: "2026-08-23T11:00:00.000Z" }), "INSUFFICIENT"],
    ["untrusted", evidence({ trust: "UNTRUSTED" }), "INSUFFICIENT"],
    ["trust unknown", evidence({ trust: "UNKNOWN", trustScore: null }), "UNAVAILABLE"],
    ["non-PIT", evidence({ pitQualified: false }), "INSUFFICIENT"],
    ["non-replayable", evidence({ replayEligible: false }), "INSUFFICIENT"],
    [
      "schema mismatch",
      evidence({ observationSchemaVersion: "future-observation-schema" }),
      "INSUFFICIENT",
    ],
    [
      "unresolved contradiction",
      evidence({ contradiction: "UNRESOLVED", contradictionGroup: "cross-source" }),
      "INSUFFICIENT",
    ],
  ])("fails closed for %s required evidence", (_label, selectedEvidence, expected) => {
    expect(evaluate(profile(), [selectedEvidence as InformationEvidenceV2]).status).toBe(expected);
  });

  it("records only an explicitly profile-approved provider substitution", () => {
    const selected = profile([
      requirement({
        satisfiers: [
          { evidenceFamily: "price", providerIds: ["htx_spot"], substitutionRuleId: null },
          {
            evidenceFamily: "equivalent-price",
            providerIds: ["qualified_backup"],
            substitutionRuleId: "qualified-price-equivalence-v1",
          },
        ],
      }),
    ]);
    const substituted = evidence({
      evidenceId: "backup-price",
      evidenceFamily: "equivalent-price",
      providerId: "qualified_backup",
    });
    const receipt = evaluate(selected, [substituted]);

    expect(receipt.status).toBe("SUFFICIENT");
    expect(receipt.requirementReceipts[0]?.substitutionsUsed).toEqual([
      { evidenceId: "backup-price", substitutionRuleId: "qualified-price-equivalence-v1" },
    ]);
    expect(
      evaluate(selected, [
        substituted,
        evidence({ evidenceId: "unknown", providerId: "unapproved" }),
      ]).requirementReceipts[0]?.acceptedEvidenceIds,
    ).not.toContain("unknown");
  });

  it("discounts duplicate/dependent evidence instead of using raw source count", () => {
    const selected = profile([requirement({ minimumIndependentGroups: 2 })]);
    const receipt = evaluate(selected, [
      evidence(),
      evidence({ evidenceId: "evidence-price-2", observationContentDigest: HEX("observation-2") }),
    ]);

    expect(receipt.status).toBe("INSUFFICIENT");
    expect(receipt.requirementReceipts[0]?.effectiveIndependentGroups).toEqual(["htx-price"]);
    expect(receipt.reasonCodes).toContain("EFFECTIVE_INDEPENDENT_INFORMATION_BELOW_PROFILE_FLOOR");
  });

  it("enforces a profile-declared agreement policy without collapsing contradiction into trust", () => {
    const selected = profile([requirement({ contradictionPolicy: "REQUIRE_AGREEMENT" })]);
    const receipt = evaluate(selected, [
      evidence({ contradiction: "CONTRADICTS", contradictionGroup: "venue-disagreement" }),
    ]);

    expect(receipt.status).toBe("INSUFFICIENT");
    expect(receipt.reasonCodes).toContain("EVIDENCE_AGREEMENT_REQUIRED");
  });

  it("does not answer WHY with price-only evidence and admits only non-holdout historical analogues", () => {
    const whyProfile = profile([requirement({ id: "why", questionId: "Q_WHY_HAPPENING" })]);
    expect(evaluate(whyProfile, [evidence()]).status).toBe("INSUFFICIENT");

    const analogueProfile = profile([
      requirement({
        id: "analogues",
        questionId: "Q_HISTORICAL_ANALOGUES",
        satisfiers: [{ evidenceFamily: "history", providerIds: [], substitutionRuleId: null }],
      }),
    ]);
    expect(
      evaluate(analogueProfile, [
        evidence({
          evidenceFamily: "history",
          epistemicRole: "HISTORICAL_ANALOGUE",
          historyScope: "DEVELOPMENT",
        }),
      ]).status,
    ).toBe("SUFFICIENT");
    expect(() =>
      evaluate(analogueProfile, [
        evidence({
          evidenceFamily: "history",
          epistemicRole: "HISTORICAL_ANALOGUE",
          historyScope: "BLIND_HOLDOUT",
        }),
      ]),
    ).toThrow("blindHoldoutEvidenceForbidden");
  });

  it("keeps purpose lanes independent and makes profile mismatch explicitly unavailable", () => {
    const newOpportunity = profile();
    const guardian = defineRequiredInformationProfileV2({
      ...newOpportunity,
      purpose: "OPEN_POSITION_REASSESSMENT",
      profileVersion: "guardian-v1",
      requirements: [requirement()],
    });

    expect(evaluate(newOpportunity, []).status).toBe("UNAVAILABLE");
    expect(evaluate(guardian, [evidence()], { purpose: "OPEN_POSITION_REASSESSMENT" }).status).toBe(
      "SUFFICIENT",
    );
    expect(evaluate(newOpportunity, [evidence()], { symbol: "ETH/USDT" })).toMatchObject({
      status: "UNAVAILABLE",
      reasonCodes: ["PROFILE_NOT_APPLICABLE"],
    });
  });

  it("requires an exact external aggregate contract result without implementing its formula", () => {
    const base = profile();
    const selected = defineRequiredInformationProfileV2({
      ...base,
      aggregateQualityContract: {
        evaluatorVersion: "later-qualified-v1",
        evaluatorContentDigest: HEX("later-qualified-contract"),
      },
    });
    expect(evaluate(selected, [evidence()]).status).toBe("UNAVAILABLE");
    expect(
      evaluate(selected, [evidence()], {
        aggregateQualityEvaluation: {
          evaluatorVersion: "later-qualified-v1",
          evaluatorContentDigest: HEX("later-qualified-contract"),
          status: "PASS",
          componentReceipts: [{ componentId: "opaque", valueDigest: HEX("value") }],
          aggregateValueDigest: HEX("aggregate"),
          reasonCodes: [],
        },
      }).status,
    ).toBe("SUFFICIENT");
  });
});
