import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ReplicaRootFamilyInput } from
  "@/lib/trader/intelligence/forecast-v2/identity-digests";
import type { SourceAnchor } from
  "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import {
  computeKmGlobalAnchorSetDigest,
  computeKmSurfaceAnchorSetDigest,
  selectKmAnchorsV1,
  type KmEligibleAnchor,
} from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  buildKmFourSurfaceContractV2,
  buildKmFourSurfaceDevelopmentAuthorityV2,
  buildKmSurfaceConvergenceReceiptFromReplayV2,
  type KmAnchorReplayEvidenceV2,
  type KmCanonicalSurfaceInputV2,
} from "@/lib/trader/research/execopp-qualification/km-four-surface-contract-v2";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000917";
const DATASET_IDENTITY = createHash("sha256").update("canonical-development").digest("hex");
const SURFACES = [
  ["BTCUSDT", 30],
  ["BTCUSDT", 60],
  ["ETHUSDT", 30],
  ["ETHUSDT", 60],
] as const;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function family(symbol: "BTCUSDT" | "ETHUSDT", horizon: 30 | 60): ReplicaRootFamilyInput {
  return {
    organizationId: ORGANIZATION_ID,
    venue: "htx",
    market: "spot",
    symbol,
    primaryHorizonMinutes: horizon,
    executionHorizonMinutes: horizon + 3,
    packageSubjectVersion: "waia.trader.historical_forecast_family_bootstrap.v2",
    terminalTargetDefinitionDigestHex: digest(`${symbol}:${horizon}:terminal`),
    executionOpportunityTargetDefinitionDigestHex: digest(`${symbol}:${horizon}:execution`),
    modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
    developmentDatasetDigestHex: DATASET_IDENTITY,
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: digest("canonical-normalization"),
    codeReleaseSha: "9".repeat(40),
  };
}

function corpus(symbol: "BTCUSDT" | "ETHUSDT", horizon: 30 | 60): SourceAnchor[] {
  const offset = (symbol === "ETHUSDT" ? 10_000 : 0) + horizon * 100_000;
  return Array.from({ length: 4_100 }, (_, index) => ({
    venue: "htx",
    market: "spot",
    symbol,
    closedBarEpochMs: (30_000_000 + offset + index) * 60_000,
    barContentDigest: digest(`${symbol}:${horizon}:bar:${index}`),
    realizedVol20m_1m: 0.005 + (index % 30) * 0.001,
    outcome13d: [
      0.001, 0.002, 0.003, (index % 11 - 5) / 1000, 0.004, 0.005, 0.006,
      100, 101, 102, 103, 104, 105,
    ],
  }));
}

function selectedAnchors(
  surfaceFamily: ReplicaRootFamilyInput,
  developmentCorpus: readonly SourceAnchor[],
): KmEligibleAnchor[] {
  const eligibleAnchors = developmentCorpus.map((anchor) => ({
    symbol: surfaceFamily.symbol,
    primaryHorizonMinutes: surfaceFamily.primaryHorizonMinutes as 30 | 60,
    anchorEpochMin: anchor.closedBarEpochMs / 60_000,
  }));
  return selectKmAnchorsV1({
    developmentDatasetDigestRaw32: Buffer.from(DATASET_IDENTITY, "hex"),
    symbol: surfaceFamily.symbol,
    primaryHorizonMinutes: surfaceFamily.primaryHorizonMinutes as 30 | 60,
    eligibleAnchors,
  });
}

function replayEvidence(anchors: readonly KmEligibleAnchor[]): KmAnchorReplayEvidenceV2[] {
  return anchors.map((anchor, anchorIndex) => {
    const reference = {
      evLower: 0.01 + (anchorIndex % 17) / 100_000,
      evBase: 0.02 + (anchorIndex % 19) / 100_000,
      evUpper: 0.03 + (anchorIndex % 23) / 100_000,
      mcEs: 0.1 + (anchorIndex % 29) / 10_000,
    };
    return {
      anchorEpochMin: anchor.anchorEpochMin,
      reference,
      cells: [10, 20, 30, 40, 50].flatMap((kConfig) =>
        [20, 40, 80].map((mConfig) => {
          const error = 0.0005 + (kConfig / 50 + mConfig / 80 + (anchorIndex % 7)) / 100_000;
          return {
            kConfig,
            mConfig,
            candidate: {
              evLower: reference.evLower * (1 + error),
              evBase: reference.evBase * (1 - error),
              evUpper: reference.evUpper * (1 + error / 2),
              mcEs: reference.mcEs * (1 - error / 2),
            },
          };
        }),
      ),
    };
  });
}

type SurfaceFixture = Omit<KmCanonicalSurfaceInputV2, "convergenceReceipt"> & {
  convergenceReceipt?: KmCanonicalSurfaceInputV2["convergenceReceipt"];
};

function rawSurfaces(): SurfaceFixture[] {
  return SURFACES.map(([symbol, horizon]) => {
    const surfaceFamily = family(symbol, horizon);
    const developmentCorpus = corpus(symbol, horizon);
    return {
      family: surfaceFamily,
      developmentCorpus,
      replayEvidence: replayEvidence(selectedAnchors(surfaceFamily, developmentCorpus)),
      replayEvidenceContentDigestHex: "",
    };
  });
}

function sealSurfaces(raw: readonly SurfaceFixture[]) {
  const surfaceDigests = raw.map((surface) => {
    const selected = selectedAnchors(surface.family, surface.developmentCorpus);
    return computeKmSurfaceAnchorSetDigest({
      developmentDatasetDigestRaw32: Buffer.from(DATASET_IDENTITY, "hex"),
      symbol: surface.family.symbol,
      primaryHorizonMinutes: surface.family.primaryHorizonMinutes,
      anchors: selected,
    });
  });
  const globalAnchorSetDigestHex =
    computeKmGlobalAnchorSetDigest(surfaceDigests).toString("hex");
  const surfaces = raw.map((surface) => {
    const replay = buildKmSurfaceConvergenceReceiptFromReplayV2({
      family: surface.family,
      developmentCorpus: surface.developmentCorpus,
      selectedAnchors: selectedAnchors(surface.family, surface.developmentCorpus),
      replayEvidence: surface.replayEvidence,
      globalAnchorSetDigestHex,
    });
    return {
      ...surface,
      convergenceReceipt: replay.receipt,
      replayEvidenceContentDigestHex: replay.replayEvidenceContentDigestHex,
    };
  });
  const developmentAuthority = buildKmFourSurfaceDevelopmentAuthorityV2({
    organizationId: ORGANIZATION_ID,
    datasetAuthorityIdentityDigestHex: DATASET_IDENTITY,
    surfaces,
  });
  return { surfaces, developmentAuthority };
}

const SEALED = sealSurfaces(rawSurfaces());

describe("DEE-917 canonical four-surface K/M contract", () => {
  it("recomputes sealed corpora, 4096-anchor replay and four independent receipts", () => {
    const forward = buildKmFourSurfaceContractV2(SEALED);
    const reverse = buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [...SEALED.surfaces].reverse(),
    });
    expect(forward).toEqual(reverse);
    expect(forward.surfaces.map((surface) => surface.surfaceKey)).toEqual([
      "BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60",
    ]);
    expect(new Set(forward.surfaces.map((surface) => surface.familyIdentityDigestHex)).size).toBe(4);
    expect(forward.surfaces.every((surface) =>
      surface.convergenceReceipt.configurations.length === 15 &&
      surface.convergenceReceipt.terminalStatus === "QUALIFIED")).toBe(true);
    expect(forward.surfaces.every((surface) =>
      surface.convergenceReceipt.configurations.every((configuration) =>
        configuration.evLowerRelativeErrorP95 > 0 &&
        configuration.evBaseRelativeErrorP95 > 0 &&
        configuration.evUpperRelativeErrorP95 > 0 &&
        configuration.mcEsRelativeErrorP95 > 0))).toBe(true);
  });

  it("fails on mutation of an unselected full-corpus anchor", () => {
    const first = SEALED.surfaces[0]!;
    const selected = new Set(selectedAnchors(first.family, first.developmentCorpus)
      .map((anchor) => anchor.anchorEpochMin));
    const unselectedIndex = first.developmentCorpus.findIndex((anchor) =>
      !selected.has(anchor.closedBarEpochMs / 60_000));
    expect(unselectedIndex).toBeGreaterThanOrEqual(0);
    const mutatedCorpus = first.developmentCorpus.map((anchor, index) =>
      index === unselectedIndex
        ? { ...anchor, outcome13d: [...anchor.outcome13d.slice(0, 12), 999] }
        : anchor);
    const mutated = { ...first, developmentCorpus: mutatedCorpus };
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [mutated, ...SEALED.surfaces.slice(1)],
    })).toThrow("DEVELOPMENT_AUTHORITY");
  });

  it("fails on replay/configuration forgery instead of trusting the receipt", () => {
    const first = SEALED.surfaces[0]!;
    const forgedConfigurations = first.convergenceReceipt.configurations.map((configuration) => ({
      ...configuration,
      evBaseRelativeErrorP95: configuration.evBaseRelativeErrorP95 / 2,
    }));
    const forged = {
      ...first,
      convergenceReceipt: { ...first.convergenceReceipt, configurations: forgedConfigurations },
    };
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [forged, ...SEALED.surfaces.slice(1)],
    })).toThrow("CONVERGENCE_RECEIPT");

    const evidence = [...first.replayEvidence];
    evidence[0] = {
      ...evidence[0]!,
      cells: evidence[0]!.cells.map((cell, index) =>
        index === 0
          ? { ...cell, candidate: { ...cell.candidate, evBase: cell.candidate.evBase * 1.2 } }
          : cell),
    };
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [{ ...first, replayEvidence: evidence }, ...SEALED.surfaces.slice(1)],
    })).toThrow("REPLAY_EVIDENCE");

    const selectedEpochs = new Set(first.replayEvidence.map((item) => item.anchorEpochMin));
    const unselectedEpoch = first.developmentCorpus.find((anchor) =>
      !selectedEpochs.has(anchor.closedBarEpochMs / 60_000))!.closedBarEpochMs / 60_000;
    const wrongEpochEvidence = [...first.replayEvidence];
    wrongEpochEvidence[0] = {
      ...wrongEpochEvidence[0]!,
      anchorEpochMin: unselectedEpoch,
    };
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [
        { ...first, replayEvidence: wrongEpochEvidence },
        ...SEALED.surfaces.slice(1),
      ],
    })).toThrow("REPLAY_ANCHOR_SET");
  });

  it("fails closed on duplicate/missing surfaces and family-anchor mismatch", () => {
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [...SEALED.surfaces.slice(0, 3), SEALED.surfaces[0]!],
    })).toThrow("DUPLICATE_SURFACE");
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: SEALED.surfaces.slice(0, 3),
    })).toThrow("MISSING_SURFACE");
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [
        { ...SEALED.surfaces[0]!, developmentCorpus: SEALED.surfaces[2]!.developmentCorpus },
        ...SEALED.surfaces.slice(1),
      ],
    })).toThrow("NON_CANONICAL_DEVELOPMENT_CORPUS");
    expect(() => buildKmFourSurfaceContractV2({
      developmentAuthority: SEALED.developmentAuthority,
      surfaces: [
        {
          ...SEALED.surfaces[0]!,
          family: {
            ...SEALED.surfaces[0]!.family,
            developmentDatasetDigestHex: digest("different-dataset-authority"),
          },
        },
        ...SEALED.surfaces.slice(1),
      ],
    })).toThrow("FAMILY_COHORT_MISMATCH");
  });
});
