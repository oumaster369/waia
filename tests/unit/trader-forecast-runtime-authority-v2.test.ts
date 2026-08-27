import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { buildForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import {
  issueForecastRuntimeV2,
  requireForecastRuntimeAuthorizedOutcomeV2,
  requireForecastRuntimeAuthorityV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  buildPredictivePackageV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { buildMarketStateSnapshotV2 } from "@/lib/trader/intelligence/predictive-admission";
import type { PredictiveAdmissionReceiptV1 } from "@/lib/trader/intelligence/predictive-admission";

const hex = (char: string) => char.repeat(64);
const organizationId = "11111111-1111-4111-8111-111111111111";
const pitAnchor = "2023-11-14T22:13:20.000Z";

function anchor(index: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_690_000_000_000 + index * 60_000,
    barContentDigest: createHash("sha256").update(String(index)).digest("hex"),
    realizedVol20m_1m: 0.01 + (index % 12) * 0.0015,
    outcome13d: Array.from({ length: 13 }, (_, coordinate) =>
      (index % 7) * 0.0004 + coordinate * 0.00001,
    ),
  };
}

function fixture(): ForecastRuntimeInputV2 {
  const family = {
    organizationId,
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: hex("a"),
    executionOpportunityTargetDefinitionDigestHex: hex("b"),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: hex("c"),
    featureVersion: "realized-volatility-20m-from-1m/v2",
    normalizationVersionDigestHex: hex("d"),
    codeReleaseSha: "e".repeat(40),
  };
  const predictivePackage = buildPredictivePackageV1({
    family,
    sourceCorpus: Array.from({ length: 180 }, (_, index) => anchor(index)),
    kConfigDec: 3,
    mConfigDec: 4,
    runtimeContract: { osClass: "linux", arch: "x64", nodeVersionExact: "v22.0.0" },
  });
  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: family.featureVersion,
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: "rv-state-conditional-empirical-joint/v1",
    modelTransformVersion: family.modelTransformVersion,
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: family.terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex:
      family.executionOpportunityTargetDefinitionDigestHex,
  });
  const modelArtifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: family.developmentDatasetDigestHex,
    runtimeContractDigestHex: digestHex(predictivePackage.runtimeContractDigest),
    artifactPayloadDigestHex: hex("f"),
  });
  const forecastContractBinding = buildForecastContractBindingV1({
    organizationId,
    scientificAdmissionReceiptId: "22222222-2222-4222-8222-222222222222",
    scientificAdmissionReceiptContentDigestHex: hex("1"),
    selectedPredictivePackageContentDigestHex: digestHex(
      predictivePackage.predictivePackageContentDigest,
    ),
    inputContract,
    modelSpec,
    modelArtifact,
  });
  const marketStateSnapshot = buildMarketStateSnapshotV2({
    organizationId,
    accountId: null,
    instrumentId: "BTC-USDT",
    symbol: "BTCUSDT",
    venue: "htx",
    analysisPurpose: "NEW_OPPORTUNITY",
    analyticalTimeframe: "1m",
    horizon: "30m",
    pitAnchor,
    runtimeContextDigestHex: hex("2"),
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    requiredInformationProfileDigestHex: hex("3"),
    informationSufficiencyReceiptDigestHex: hex("4"),
    reconstructionDigestHex: hex("5"),
    stateRepresentationSpecDigestHex: hex("6"),
    dynamicStateDescriptorDigestHex: hex("7"),
    understandingClaimSetDigestHex: hex("8"),
    activeKnowledgeStateDigestHex: hex("9"),
    selectedKnowledgeClaimDigestsHex: [hex("a")],
    selectedFailureBoundaryDigestsHex: [hex("b")],
    hypothesisAssessmentSetDigestHex: hex("c"),
    consumedHypothesisAssessments: [
      {
        hypothesisAssessmentContentDigestHex: hex("d"),
        evaluatorIdentityDigestHex: hex("e"),
        status: "APPLICABLE",
      },
    ],
    sourceProfileDigestHex: hex("f"),
    representationProfileDigestHex: hex("1"),
    anchorRealizedVol20m_1m: 0.018,
    forecastContractBinding,
  });
  const receiptBody = {
    schemaVersion: "waia.trader.predictive_admission_receipt.v1" as const,
    verdict: "ADMITTED" as const,
    capitalAuthority: "NONE" as const,
    analysisPurpose: "NEW_OPPORTUNITY" as const,
    pitAnchor,
    marketStateSnapshotContentDigestHex: marketStateSnapshot.contentDigestHex,
    selectedPredictivePackageContentDigestHex:
      forecastContractBinding.selectedPredictivePackageContentDigestHex,
    scientificAdmissionReceiptContentDigestHex:
      forecastContractBinding.scientificAdmissionReceiptContentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    modelSpecDigestHex: modelSpec.contentDigestHex,
    modelArtifactDigestHex: modelArtifact.contentDigestHex,
    qualifiedInputBindingDigestHex: marketStateSnapshot.qualifiedInputBindingDigestHex,
    blockingReasons: [] as const,
  };
  const predictiveAdmissionReceipt: PredictiveAdmissionReceiptV1 = {
    ...receiptBody,
    contentDigestHex: computeSemanticSha256Hex(receiptBody),
  };
  return {
    predictiveAdmissionReceipt,
    marketStateSnapshot,
    forecastContractBinding,
    predictivePackage,
    executionHorizonMinutes: 33,
    normalizationVersionDigestHex: family.normalizationVersionDigestHex,
  };
}

describe("DEE-756 Forecast Runtime Authority V2", () => {
  it("issues and replays one deterministic, content-addressed Forecast authority", () => {
    const input = fixture();
    const first = issueForecastRuntimeV2(input);
    const second = issueForecastRuntimeV2(input);
    expect(first.status).toBe("FORECAST_AUTHORIZED");
    expect(second).toEqual(first);
    if (first.status !== "FORECAST_AUTHORIZED") throw new Error("expected authority");
    expect(requireForecastRuntimeAuthorizedOutcomeV2(first)).toBe(first);
    expect(JSON.stringify(first.authority)).not.toMatch(
      /BUY|SELL|confidence|expectedEdge|riskMultiplier|capitalEligible/,
    );
  });

  it("returns typed NON_ACTIONABLE for absent and non-admitted inputs", () => {
    const input = fixture();
    expect(
      issueForecastRuntimeV2({ ...input, predictiveAdmissionReceipt: null }),
    ).toMatchObject({ status: "NON_ACTIONABLE", reason: "MISSING_OR_NOT_ADMITTED" });
    expect(
      issueForecastRuntimeV2({
        ...input,
        predictiveAdmissionReceipt: {
          ...input.predictiveAdmissionReceipt!,
          verdict: "RESEARCH_ONLY",
          analysisPurpose: "RESEARCH_NON_CAPITAL",
        },
      }),
    ).toMatchObject({ status: "NON_ACTIONABLE", reason: "MISSING_OR_NOT_ADMITTED" });
  });

  it.each([
    ["package", (value: ForecastRuntimeInputV2) => ({ ...value, executionHorizonMinutes: 60 })],
    [
      "normalization contract",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        normalizationVersionDigestHex: hex("0"),
      }),
    ],
    [
      "executable pool payload",
      (value: ForecastRuntimeInputV2) => {
        const artifact = value.predictivePackage!.replicaArtifacts[0]!;
        const observation = artifact.pools.S0[0]!;
        return {
          ...value,
          predictivePackage: {
            ...value.predictivePackage!,
            replicaArtifacts: [
              {
                ...artifact,
                pools: {
                  ...artifact.pools,
                  S0: [
                    {
                      ...observation,
                      anchor: {
                        ...observation.anchor,
                        outcome13d: observation.anchor.outcome13d.map((component, index) =>
                          index === 0 ? component + 0.5 : component,
                        ),
                      },
                    },
                    ...artifact.pools.S0.slice(1),
                  ],
                },
              },
              ...value.predictivePackage!.replicaArtifacts.slice(1),
            ],
          },
        };
      },
    ],
    [
      "executable replica threshold",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        predictivePackage: {
          ...value.predictivePackage!,
          replicaArtifacts: value.predictivePackage!.replicaArtifacts.map(
            (artifact, index) => (index === 0 ? { ...artifact, q1: artifact.q1 + 0.5 } : artifact),
          ),
        },
      }),
    ],
    [
      "binding",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        forecastContractBinding: {
          ...value.forecastContractBinding!,
          contentDigestHex: hex("0"),
        },
      }),
    ],
    [
      "PIT snapshot",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        marketStateSnapshot: {
          ...value.marketStateSnapshot!,
          anchorRealizedVol20m_1m: 0.019,
        },
      }),
    ],
  ] as const)("fails closed on %s identity mismatch", (_label, mutate) => {
    expect(issueForecastRuntimeV2(mutate(fixture())).status).toBe("NON_ACTIONABLE");
  });

  it("rejects authority and issuance seal tampering on replay", () => {
    const result = issueForecastRuntimeV2(fixture());
    if (result.status !== "FORECAST_AUTHORIZED") throw new Error("expected authority");
    expect(() =>
      requireForecastRuntimeAuthorityV2({
        ...result.authority,
        terminalForecastContentDigestHex: hex("0"),
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORITY_INVALID");
    const forgedPitBody = {
      ...result.authority,
      anchorClosedBarAt: "2023-11-14T22:14:20.000Z",
    };
    const { contentDigestHex: _oldDigest, ...forgedPitBodyWithoutDigest } = forgedPitBody;
    void _oldDigest;
    expect(() =>
      requireForecastRuntimeAuthorityV2({
        ...forgedPitBody,
        contentDigestHex: computeSemanticSha256Hex(forgedPitBodyWithoutDigest),
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORITY_INVALID");
    expect(() =>
      requireForecastRuntimeAuthorizedOutcomeV2({
        ...result,
        issuance: {
          ...result.issuance,
          distributionSemanticDigestTerminal: Buffer.alloc(32),
        },
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:replay");
    expect(() =>
      requireForecastRuntimeAuthorizedOutcomeV2({
        ...result,
        issuance: {
          ...result.issuance,
          actionable: false,
          reasonCodes: ["FORGED"],
        },
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:replay");
    expect(() =>
      requireForecastRuntimeAuthorizedOutcomeV2({
        ...result,
        issuance: {
          ...result.issuance,
          package: {
            ...result.issuance.package,
            terminalTargetGridIdentityDigestHex: hex("0"),
          },
        },
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:replay");
  });
});
