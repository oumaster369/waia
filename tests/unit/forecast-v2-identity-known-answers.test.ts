import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  MODEL_TRANSFORM_VERSION,
  ALPHA_EPI_CONFIG_SCALE8,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  computeForecastGenerationIdentityDigest,
  computeForecastSamplingFamilyIdentityDigest,
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaRootFamilyIdentityDigest,
  computeRuntimeContractDigest,
  digestHex,
} from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  buildPoolSemanticDigestStream,
  computePoolSemanticDigest,
} from "@/lib/trader/intelligence/forecast-v2/pool-semantic-digest-v1";
import { ScientificIdentityValidationError } from "@/lib/trader/intelligence/forecast-v2/scientific-identity-validators-v1";
import {
  computeTrialIdentityDigestV2,
  serializeTrialIdentityV2,
} from "@/lib/trader/research/benchmark/trial-identity-v2";

const family = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  venue: "htx",
  market: "spot",
  symbol: "BTCUSDT",
  primaryHorizonMinutes: 30,
  executionHorizonMinutes: 33,
  packageSubjectVersion: "pkg-subject/v1",
  terminalTargetDefinitionDigestHex: "a".repeat(64),
  executionOpportunityTargetDefinitionDigestHex: "b".repeat(64),
  modelTransformVersion: MODEL_TRANSFORM_VERSION,
  developmentDatasetDigestHex: createHash("sha256").update("dev-dataset").digest("hex"),
  featureVersion: "feature-engine/rv/v2",
  normalizationVersionDigestHex: "c".repeat(64),
  codeReleaseSha: "d".repeat(40),
};

describe("forecast-v2 identity known answers E1", () => {
  it("matches frozen replica-root-family/v1 digest", () => {
    expect(digestHex(computeReplicaRootFamilyIdentityDigest(family))).toBe(
      "b9296c89037ab37e82567b4de809ac72cc9abf520e7d64170caf7160e2281832",
    );
  });

  it("matches frozen pkg-gen-id/v2 digest", () => {
    const rootHex = digestHex(computeReplicaRootFamilyIdentityDigest(family));
    expect(
      digestHex(
        computePredictivePackageGenerationIdentityDigest({
          replicaRootFamilyIdentityDigestHex: rootHex,
          kConfigDec: 10,
          mConfigDec: 20,
          alphaEpiConfigScale8: ALPHA_EPI_CONFIG_SCALE8,
        }),
      ),
    ).toBe("06a5efc14e14f1ea9907efc4bb90026673a3fab58e17dbac5b73599e703bc6fc");
  });

  it("K/M/alpha changes pkg-gen-id but not replica-root-family", () => {
    const rootA = digestHex(computeReplicaRootFamilyIdentityDigest(family));
    const rootB = digestHex(
      computeReplicaRootFamilyIdentityDigest({
        ...family,
        primaryHorizonMinutes: 60,
      }),
    );
    const genA = digestHex(
      computePredictivePackageGenerationIdentityDigest({
        replicaRootFamilyIdentityDigestHex: rootA,
        kConfigDec: 10,
        mConfigDec: 20,
        alphaEpiConfigScale8: ALPHA_EPI_CONFIG_SCALE8,
      }),
    );
    const genB = digestHex(
      computePredictivePackageGenerationIdentityDigest({
        replicaRootFamilyIdentityDigestHex: rootA,
        kConfigDec: 20,
        mConfigDec: 40,
        alphaEpiConfigScale8: ALPHA_EPI_CONFIG_SCALE8,
      }),
    );
    expect(rootA).not.toBe(rootB);
    expect(genA).not.toBe(genB);
  });

  it("matches runtime-contract/v1, forecast-sampling-family/v1, fcst-gen-id/v1", () => {
    const rootHex = digestHex(computeReplicaRootFamilyIdentityDigest(family));
    const runtimeHex = digestHex(
      computeRuntimeContractDigest({
        osClass: "linux",
        arch: "x64",
        nodeVersionExact: "v22.0.0",
        codeReleaseSha: family.codeReleaseSha,
        modelTransformVersion: MODEL_TRANSFORM_VERSION,
      }),
    );
    expect(runtimeHex).toBe("6149344ebc552125aa16514adf0b2f624ba37abb073e3d5d491954e498d8c2a0");
    expect(
      digestHex(
        computeForecastSamplingFamilyIdentityDigest({
          replicaRootFamilyIdentityDigestHex: rootHex,
          organizationId: family.organizationId,
          venue: family.venue,
          market: family.market,
          symbol: family.symbol,
          anchorClosedBarEpochMs: 1_700_000_000_000,
          primaryHorizonMinutes: 30,
          executionHorizonMinutes: 33,
          runtimeContractDigestHex: runtimeHex,
        }),
      ),
    ).toBe("35f6ac163887cf6e4270121c0b778f214d325fb5b71efe3db3f67108371d855e");
    expect(
      digestHex(
        computeForecastGenerationIdentityDigest({
          predictivePackageContentDigestHex: "e".repeat(64),
          organizationId: family.organizationId,
          venue: family.venue,
          market: family.market,
          symbol: family.symbol,
          anchorClosedBarEpochMs: 1_700_000_000_000,
          primaryHorizonMinutes: 30,
          executionHorizonMinutes: 33,
          terminalTargetRoleId: "TERMINAL_RETURN",
          executionTargetRoleId: "EXECUTION_OPPORTUNITY",
          runtimeContractDigestHex: runtimeHex,
        }),
      ),
    ).toBe("efab56b1239d447710f2ae252db52f09e54412ce2bf7f92e5ff183e2467c5337");
  });

  it("matches pool-sem/v1 and trial-id/v2 digests", () => {
    const poolStream = buildPoolSemanticDigestStream({
      organizationId: family.organizationId,
      venue: family.venue,
      market: family.market,
      symbol: family.symbol,
      primaryHorizonMinutes: 30,
      replicaOrdinal: 0,
      stateId: "S0",
      developmentDatasetDigestHex: family.developmentDatasetDigestHex,
      observations: [
        {
          resamplePositionOrdinal: 0,
          anchor: {
            venue: "htx",
            market: "spot",
            symbol: "BTCUSDT",
            closedBarEpochMs: 1_700_000_000_000,
            barContentDigest: createHash("sha256").update("0").digest("hex"),
            realizedVol20m_1m: 0.01,
            outcome13d: [0, 0, 0, -0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          },
        },
      ],
    });
    expect(
      digestHex(
        computePoolSemanticDigest({
          organizationId: family.organizationId,
          venue: family.venue,
          market: family.market,
          symbol: family.symbol,
          primaryHorizonMinutes: 30,
          replicaOrdinal: 0,
          stateId: "S0",
          developmentDatasetDigestHex: family.developmentDatasetDigestHex,
          observations: [
            {
              resamplePositionOrdinal: 0,
              anchor: {
                venue: "htx",
                market: "spot",
                symbol: "BTCUSDT",
                closedBarEpochMs: 1_700_000_000_000,
                barContentDigest: createHash("sha256").update("0").digest("hex"),
                realizedVol20m_1m: 0.01,
                outcome13d: [0, 0, 0, -0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0],
              },
            },
          ],
        }),
      ),
    ).toBe("a968b9b9c6a0ab5ff35b50aad26c8101055adcf15c698046fa5b013891783703");
    expect(poolStream.subarray(0, 8).toString("utf8")).toBe("pool-sem");

    const trialInput = {
      scoringContractVersion: "scoring/v1",
      evaluationPartitionReceiptDigestHex: "f".repeat(64),
      venue: "htx",
      market: "spot",
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      modelTransformVersion: MODEL_TRANSFORM_VERSION,
      challengerPackageContentDigestHex: "e".repeat(64),
      baselineId: "empirical-climatology/v1",
      metricId: "multiclass-log-score/v1",
      commonAnchorSetDigestHex: "9".repeat(64),
      purgeDurationMinutes: 0,
      embargoDurationMinutes: 0,
      comparisonFamilyId: "baseline-mandatory/v1",
    };
    expect(digestHex(computeTrialIdentityDigestV2(trialInput))).toBe(
      "e61252ea09a20200bf317418a1e8ad9561cf0ff1bcb09eca358c60e1e8da79c4",
    );
    expect(serializeTrialIdentityV2(trialInput).subarray(0, 10).toString("utf8")).toBe(
      "trial-id/v",
    );
  });

  it("fail-closed on bad git sha and uppercase digest", () => {
    expect(() =>
      computeReplicaRootFamilyIdentityDigest({
        ...family,
        codeReleaseSha: "D".repeat(40),
      }),
    ).toThrow(ScientificIdentityValidationError);
    expect(() =>
      computePredictivePackageGenerationIdentityDigest({
        replicaRootFamilyIdentityDigestHex: "A".repeat(64),
        kConfigDec: 10,
        mConfigDec: 20,
        alphaEpiConfigScale8: ALPHA_EPI_CONFIG_SCALE8,
      }),
    ).toThrow(ScientificIdentityValidationError);
  });
});
