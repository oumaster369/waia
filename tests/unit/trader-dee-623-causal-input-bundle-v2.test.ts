import { describe, expect, it } from "vitest";

import type { MarketUnderstandingArtifactV1 } from "@/lib/trader/intelligence/market-understanding.types";
import type { MarketStateSnapshot } from "@/lib/trader/intelligence/mi-core.types";
import {
  buildCanonicalCycleCausalInputBundleV2,
  computeCanonicalCycleCausalInputDigestV2,
  parseCanonicalCycleCausalInputBundleV2,
  serializeCanonicalCycleCausalInputBundleV2,
} from "@/lib/trader/intelligence/records/causal-input-bundle-v2";

const d = (character: string) => character.repeat(64);
const evaluatedAt = "2026-08-26T00:00:00.000Z";

function snapshot(reconstructionDigest = d("a")): MarketStateSnapshot {
  return {
    schemaVersion: "waia.trader.market_state_snapshot.v1",
    evaluatedAt,
    instrumentId: "BTC/USDT",
    reconstruction: {
      schemaVersion: "waia.trader.reconstruction_snapshot.v1",
      instrumentId: "BTC/USDT",
      evaluatedAt,
      marketStructure: {
        swingHighs: [], swingLows: [], structureBias: "NEUTRAL", higherHighSequence: false,
        lowerLowSequence: false, priorDayHigh: null, priorDayLow: null, sessionHigh: null,
        sessionLow: null, breakOfStructure: false, changeOfCharacter: false,
      },
      liquidityStructure: {
        levels: [], nearestObjectiveAbove: null, nearestObjectiveBelow: null,
        unsweptHighCount: 0, unsweptLowCount: 0,
      },
      trendStructure: { perTimeframeBias: {}, mtfAlignment: "UNCLEAR", regimeBias: "UNKNOWN" },
      volatilityStructure: { atrUsdt: null, atrPeriod: 14, volatilityRegime: "UNKNOWN", expansionRatio: null },
      participationStructure: { relativeVolume: null, volumeAnomaly: false, effortVsResult: "UNKNOWN" },
      contextStructure: { sessionPhase: "UNKNOWN", fearGreedIndex: null, crossVenueAgreement: null, contextOnly: true },
      contentDigest: reconstructionDigest,
    },
    understanding: null,
    hypotheses: { schemaVersion: "waia.trader.hypothesis_set.v1", evaluatedAt, hypotheses: [], activeHypothesis: null, opportunity: null },
    activeOpportunity: null,
    tradingPermission: "STOP_TRADING",
    terminalReasonCode: "NO_TRADE",
    conviction: 0,
    eligibleStrategyFamilies: [],
  };
}

function artifact(overrides: {
  observationDigest?: string;
  measurementDigest?: string;
  receiptDigest?: string;
} = {}): MarketUnderstandingArtifactV1 {
  const evidence = {
    evidenceId: "evidence-1", evidenceFamily: "MARKET_STRUCTURE", providerId: "provider-1",
    sourceId: "source-1", observationId: "observation-1", observationKind: "MARKET_BAR",
    observationSchemaVersion: "observation/v1",
    observationContentDigest: overrides.observationDigest ?? d("b"), trustAsOfReceiptId: d("c"),
    trustRevisionId: "trust-revision-1", trustRevisionContentDigest: d("d"),
    measurementDefinitionId: "measurement-definition-1", measurementDefinitionContentDigest: d("e"),
    measurementValueId: "measurement-value-1", measurementValueContentDigest: overrides.measurementDigest ?? d("f"),
    availability: "AVAILABLE", trust: "TRUSTED", trustScore: 1, pitQualified: true,
    replayEligible: true, dependenceGroup: "price", contradictionGroup: null,
    contradiction: "NONE", epistemicRole: "PRIMARY", historyScope: "PIT", availableAt: evaluatedAt,
    degradationReasonCodes: [],
  } as const;
  return {
    schemaVersion: "market-understanding-artifact/v1",
    authenticatedProfile: { id: "profile-1", contentDigest: d("1") },
    authenticatedSufficiencyReceipt: { id: "receipt-1", contentDigest: overrides.receiptDigest ?? d("2") },
    scope: { organizationId: "org-1", symbol: "BTC/USDT", pitAnchor: evaluatedAt },
    evaluatedAt,
    derivationDefinition: { contentDigest: d("3") },
    claims: [{ contentDigest: d("4"), causalLineageDigest: d("5"), computationInputs: [{ path: "features.close", contentDigest: d("6") }] }],
    evidenceUsed: [evidence], evidenceIgnored: [], contentDigest: d("7"),
  } as unknown as MarketUnderstandingArtifactV1;
}

function build(input: { reconstructionDigest?: string; understandingArtifact?: MarketUnderstandingArtifactV1; runtimeNonce?: string } = {}) {
  return buildCanonicalCycleCausalInputBundleV2({
    organizationId: "org-1",
    snapshot: snapshot(input.reconstructionDigest),
    understandingArtifact: input.understandingArtifact,
    historicalProfileId: "historical-profile-1",
    historicalProfileContentDigest: d("8"),
    matrixContentDigest: d("9"),
    runtimeNonce: input.runtimeNonce,
  } as Parameters<typeof buildCanonicalCycleCausalInputBundleV2>[0]);
}

describe("DEE-623 canonical causal input bundle v2", () => {
  it("changes identity for omitted causal Reconstruction, Observation, Measurement and ISG state", () => {
    const baseline = computeCanonicalCycleCausalInputDigestV2(build({ understandingArtifact: artifact() }));
    expect(computeCanonicalCycleCausalInputDigestV2(build({ reconstructionDigest: d("0"), understandingArtifact: artifact() }))).not.toBe(baseline);
    expect(computeCanonicalCycleCausalInputDigestV2(build({ understandingArtifact: artifact({ observationDigest: d("a") }) }))).not.toBe(baseline);
    expect(computeCanonicalCycleCausalInputDigestV2(build({ understandingArtifact: artifact({ measurementDigest: d("a") }) }))).not.toBe(baseline);
    expect(computeCanonicalCycleCausalInputDigestV2(build({ understandingArtifact: artifact({ receiptDigest: d("a") }) }))).not.toBe(baseline);
  });

  it("is replay deterministic and ignores non-causal operational metadata", () => {
    const first = build({ understandingArtifact: artifact(), runtimeNonce: "worker-a" });
    const second = build({ understandingArtifact: artifact(), runtimeNonce: "worker-b" });
    expect(serializeCanonicalCycleCausalInputBundleV2(second)).toBe(serializeCanonicalCycleCausalInputBundleV2(first));
    expect(computeCanonicalCycleCausalInputDigestV2(second)).toBe(computeCanonicalCycleCausalInputDigestV2(first));
    expect(parseCanonicalCycleCausalInputBundleV2(serializeCanonicalCycleCausalInputBundleV2(first))).toEqual(first);
    expect(() => parseCanonicalCycleCausalInputBundleV2(JSON.stringify({ ...first, retryCount: 1 }))).toThrow(
      "CAUSAL_INPUT_BUNDLE_INVALID:canonicalIdentity",
    );
  });
});
