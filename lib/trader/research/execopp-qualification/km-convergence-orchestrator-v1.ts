import { createHash } from "node:crypto";

import {
  computeReplicaPayoffMeans,
  computeDecisionEvRangeV1,
  piBaseV1,
  piLowerV1,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2";
import {
  buildPredictivePackageV1,
  issueForecastV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import { energyMcFromNestedCubeV1 } from "@/lib/trader/research/benchmark/energy-mc-v1";
import {
  assertKmComputeBudgetV1,
  buildKmConvergenceReceiptV1,
  computeKmGlobalAnchorSetDigest,
  computeKmSurfaceAnchorSetDigest,
  evaluateKmConfigurationV1,
  KM_GRID_K,
  KM_GRID_M,
  KM_GLOBAL_ANCHOR_COUNT,
  KM_REFERENCE_K,
  KM_REFERENCE_M,
  relativeErrorV1,
  selectKmAnchorsV1,
  selectKmWinnerV1,
  type KmConvergenceReceipt,
  type KmEligibleAnchor,
} from "./km-convergence-gate-v1";

export const KM_CONVERGENCE_ORCHESTRATOR_VERSION = "km-convergence-orchestrator/v1" as const;

export type KmDevelopmentAnchorInput = {
  symbol: string;
  primaryHorizonMinutes: 30 | 60;
  anchorEpochMin: number;
  anchorClosedBarEpochMs: number;
  anchorRealizedVol20m_1m: number;
  sourceCorpus: readonly SourceAnchor[];
  executionHorizonMinutes: number;
};

export type KmConvergenceOrchestratorInput = {
  developmentDatasetDigestRaw32: Buffer;
  family: ReplicaRootFamilyInput;
  developmentAnchors: readonly KmDevelopmentAnchorInput[];
  notionalUsdt: number;
  costRate: number;
  slippageBufferUsdt: number;
  normalizationVersionDigestHex: string;
  nRefUsdt: number;
};

export type KmCellPackageDigests = {
  kConfig: number;
  mConfig: number;
  predictivePackageGenerationIdentityDigestHex: string;
  predictivePackageContentDigestHex: string;
};

function deriveEligibleKmAnchors(input: KmConvergenceOrchestratorInput): KmEligibleAnchor[] {
  return input.developmentAnchors.map((a) => ({
    symbol: a.symbol,
    primaryHorizonMinutes: a.primaryHorizonMinutes,
    anchorEpochMin: a.anchorEpochMin,
  }));
}

const KM_SURFACES: Array<{ symbol: string; primaryHorizonMinutes: 30 | 60 }> = [
  { symbol: "BTCUSDT", primaryHorizonMinutes: 30 },
  { symbol: "BTCUSDT", primaryHorizonMinutes: 60 },
  { symbol: "ETHUSDT", primaryHorizonMinutes: 30 },
  { symbol: "ETHUSDT", primaryHorizonMinutes: 60 },
];

function buildGlobalAnchorDigest(input: {
  developmentDatasetDigestRaw32: Buffer;
  eligible: readonly KmEligibleAnchor[];
}): Buffer {
  const digests = KM_SURFACES.map((surface) =>
    computeKmSurfaceAnchorSetDigest({
      developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
      anchors: selectKmAnchorsV1({
        developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
        symbol: surface.symbol,
        primaryHorizonMinutes: surface.primaryHorizonMinutes,
        eligibleAnchors: input.eligible,
      }),
    }),
  );
  return computeKmGlobalAnchorSetDigest(digests);
}

function selectGlobalKmAnchors(input: {
  developmentDatasetDigestRaw32: Buffer;
  eligible: readonly KmEligibleAnchor[];
}): KmEligibleAnchor[] {
  const selected: KmEligibleAnchor[] = [];
  for (const surface of KM_SURFACES) {
    selected.push(
      ...selectKmAnchorsV1({
        developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
        symbol: surface.symbol,
        primaryHorizonMinutes: surface.primaryHorizonMinutes,
        eligibleAnchors: input.eligible,
      }),
    );
  }
  if (selected.length !== KM_GLOBAL_ANCHOR_COUNT) {
    throw new Error("KM_GATE_INCOMPLETE_GLOBAL_ANCHOR_SET");
  }
  return selected;
}

function prefixSamples(fullSamples: number[][][], kConfig: number, mConfig: number): number[][][] {
  return fullSamples.slice(0, kConfig).map((replica) => replica.slice(0, mConfig));
}

export function runKmConvergenceOrchestratorV1(input: KmConvergenceOrchestratorInput): {
  receipt: KmConvergenceReceipt;
  cellDigests: readonly KmCellPackageDigests[];
} {
  assertKmComputeBudgetV1();

  if (!(input.nRefUsdt > 0)) {
    throw new Error("KM_GATE_INVALID_ZERO_NOTIONAL");
  }

  const eligible = deriveEligibleKmAnchors(input);
  const kmGlobalAnchorSetDigest = buildGlobalAnchorDigest({
    developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
    eligible,
  });
  const selectedAnchors = selectGlobalKmAnchors({
    developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
    eligible,
  });

  const developmentAnchorByKey = new Map(
    input.developmentAnchors.map((anchor) => [
      `${anchor.symbol}:${anchor.primaryHorizonMinutes}:${anchor.anchorEpochMin}`,
      anchor,
    ]),
  );

  const referencePkg = buildPredictivePackageV1({
    family: input.family,
    sourceCorpus: input.developmentAnchors[0]?.sourceCorpus ?? [],
    kConfigDec: KM_REFERENCE_K,
    mConfigDec: KM_REFERENCE_M,
  });

  const anchorMetrics = new Map<
    string,
    {
      referenceEvLower: number;
      referenceEvBase: number;
      referenceEvUpper: number;
      referenceMcEs: number;
      byCell: Map<
        string,
        { evLower: number; evBase: number; evUpper: number; mcEs: number; ops: number }
      >;
    }
  >();

  for (const selected of selectedAnchors) {
    const anchor = developmentAnchorByKey.get(
      `${selected.symbol}:${selected.primaryHorizonMinutes}:${selected.anchorEpochMin}`,
    );
    if (!anchor) {
      throw new Error("KM_GATE_SELECTED_ANCHOR_MISSING_DEVELOPMENT_INPUT");
    }

    const issuance = issueForecastV1({
      pkg: referencePkg,
      anchorClosedBarEpochMs: anchor.anchorClosedBarEpochMs,
      anchorRealizedVol20m_1m: anchor.anchorRealizedVol20m_1m,
      executionHorizonMinutes: anchor.executionHorizonMinutes,
      normalizationVersionDigestHex: input.normalizationVersionDigestHex,
    });

    const refSamples = issuance.samples;
    const refMeans = computeReplicaPayoffMeans({
      notionalUsdt: input.notionalUsdt,
      costRate: input.costRate,
      slippageBufferUsdt: input.slippageBufferUsdt,
      replicaSamples: refSamples,
    });
    const refEv = computeDecisionEvRangeV1({
      muBaseReplicas: refMeans.muBaseReplicas,
      muLowerReplicas: refMeans.muLowerReplicas,
      scientificAdmissionVerified: false,
    });
    const refEvRate = refEv.evBase / input.nRefUsdt;
    const refMcEs = energyMcFromNestedCubeV1(refSamples, refSamples[0]?.[0] ?? []);

    const byCell = new Map<
      string,
      { evLower: number; evBase: number; evUpper: number; mcEs: number; ops: number }
    >();

    for (const kConfig of KM_GRID_K) {
      for (const mConfig of KM_GRID_M) {
        const cellKey = `${kConfig}:${mConfig}`;
        const cellSamples = prefixSamples(refSamples, kConfig, mConfig);
        const ops = kConfig * mConfig;
        if (ops > 1e5) {
          throw new Error("KM_GATE_OPS_BUDGET_EXCEEDED");
        }
        const means = computeReplicaPayoffMeans({
          notionalUsdt: input.notionalUsdt,
          costRate: input.costRate,
          slippageBufferUsdt: input.slippageBufferUsdt,
          replicaSamples: cellSamples,
        });
        const ev = computeDecisionEvRangeV1({
          muBaseReplicas: means.muBaseReplicas,
          muLowerReplicas: means.muLowerReplicas,
          scientificAdmissionVerified: false,
        });
        byCell.set(cellKey, {
          evLower: ev.evLower / input.nRefUsdt,
          evBase: ev.evBase / input.nRefUsdt,
          evUpper: ev.evUpper / input.nRefUsdt,
          mcEs: energyMcFromNestedCubeV1(cellSamples, cellSamples[0]?.[0] ?? []),
          ops,
        });
      }
    }

    anchorMetrics.set(`${anchor.symbol}:${anchor.primaryHorizonMinutes}:${anchor.anchorEpochMin}`, {
      referenceEvLower: refEv.evLower / input.nRefUsdt,
      referenceEvBase: refEvRate,
      referenceEvUpper: refEv.evUpper / input.nRefUsdt,
      referenceMcEs: refMcEs,
      byCell,
    });
  }

  const configurations = [];
  const cellDigests: KmCellPackageDigests[] = [];

  for (const kConfig of KM_GRID_K) {
    for (const mConfig of KM_GRID_M) {
      const pkg = buildPredictivePackageV1({
        family: input.family,
        sourceCorpus: input.developmentAnchors[0]?.sourceCorpus ?? [],
        kConfigDec: kConfig,
        mConfigDec: mConfig,
      });
      cellDigests.push({
        kConfig,
        mConfig,
        predictivePackageGenerationIdentityDigestHex: digestHex(
          pkg.predictivePackageGenerationIdentityDigest,
        ),
        predictivePackageContentDigestHex: digestHex(pkg.predictivePackageContentDigest),
      });

      const perAnchorEvLowerErrors: number[] = [];
      const perAnchorEvBaseErrors: number[] = [];
      const perAnchorEvUpperErrors: number[] = [];
      const perAnchorMcEsErrors: number[] = [];

      for (const anchor of selectedAnchors) {
        const devAnchor = developmentAnchorByKey.get(
          `${anchor.symbol}:${anchor.primaryHorizonMinutes}:${anchor.anchorEpochMin}`,
        );
        if (!devAnchor) {
          continue;
        }
        const key = `${devAnchor.symbol}:${devAnchor.primaryHorizonMinutes}:${devAnchor.anchorEpochMin}`;
        const metrics = anchorMetrics.get(key);
        if (!metrics) {
          continue;
        }
        const cell = metrics.byCell.get(`${kConfig}:${mConfig}`);
        if (!cell) {
          continue;
        }
        perAnchorEvLowerErrors.push(relativeErrorV1(cell.evLower, metrics.referenceEvLower));
        perAnchorEvBaseErrors.push(relativeErrorV1(cell.evBase, metrics.referenceEvBase));
        perAnchorEvUpperErrors.push(relativeErrorV1(cell.evUpper, metrics.referenceEvUpper));
        perAnchorMcEsErrors.push(relativeErrorV1(cell.mcEs, metrics.referenceMcEs));
      }

      configurations.push(
        evaluateKmConfigurationV1({
          kConfig,
          mConfig,
          perAnchorEvLowerErrors,
          perAnchorEvBaseErrors,
          perAnchorEvUpperErrors,
          perAnchorMcEsErrors,
        }),
      );
    }
  }

  if (configurations.length !== KM_GRID_K.length * KM_GRID_M.length) {
    throw new Error("KM_GATE_INCOMPLETE_CONFIGURATION_GRID");
  }

  const winner = selectKmWinnerV1(configurations);
  const winnerDigests = winner
    ? cellDigests.find((c) => c.kConfig === winner.kConfig && c.mConfig === winner.mConfig)
    : undefined;

  if (winner && !winnerDigests) {
    throw new Error("KM_GATE_WINNER_DIGEST_MISMATCH");
  }

  const receipt = buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: digestHex(referencePkg.replicaRootFamilyIdentityDigest),
    kmGlobalAnchorSetDigestHex: kmGlobalAnchorSetDigest.toString("hex"),
    candidateGenerationDigestsHex: cellDigests.map(
      (c) => c.predictivePackageGenerationIdentityDigestHex,
    ),
    configurations,
    selectedPackageGenerationIdentityDigestHex:
      winnerDigests?.predictivePackageGenerationIdentityDigestHex ?? null,
    selectedPackageContentDigestHex: winnerDigests?.predictivePackageContentDigestHex ?? null,
  });

  return { receipt, cellDigests };
}
