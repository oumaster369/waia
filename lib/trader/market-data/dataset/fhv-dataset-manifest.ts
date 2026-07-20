import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import {
  evaluateGapPolicy,
  FHV_GAP_POLICY_V1,
  type GapPolicyResult,
} from "@/lib/trader/market-data/dataset/fhv-gap-policy";
import type {
  GapRecord,
  IngressIntegrityResults,
  IngressSourceProvenance,
} from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { Bar } from "@/lib/trader/intelligence/types";

export const FHV_DATASET_MANIFEST_SCHEMA_VERSION = "fhv-dataset-manifest/v1" as const;

export type FhvUtcHalfOpenInterval = {
  startUtc: string;
  endUtc: string;
};

export type FhvBlindHoldoutPartition = FhvUtcHalfOpenInterval & {
  status: "SEALED_NOT_ACCESSED";
};

export type FhvDatasetPartitionsV1 = {
  development: FhvUtcHalfOpenInterval;
  walkForward: FhvUtcHalfOpenInterval;
  blindHoldout: FhvBlindHoldoutPartition;
};

export const FHV_DATASET_PARTITIONS_V1: FhvDatasetPartitionsV1 = {
  development: {
    startUtc: "2020-01-01T00:00:00.000Z",
    endUtc: "2023-01-01T00:00:00.000Z",
  },
  walkForward: {
    startUtc: "2023-01-01T00:00:00.000Z",
    endUtc: "2025-01-01T00:00:00.000Z",
  },
  blindHoldout: {
    startUtc: "2025-01-01T00:00:00.000Z",
    endUtc: "2026-01-01T00:00:00.000Z",
    status: "SEALED_NOT_ACCESSED",
  },
};

export type FhvDatasetManifestV1 = {
  schemaVersion: typeof FHV_DATASET_MANIFEST_SCHEMA_VERSION;
  venueScope: "HTX_ONLY";
  marketType: "SPOT";
  symbols: readonly ["BTCUSDT", "ETHUSDT"];
  baseInterval: "1m";
  derivedIntervals: readonly ["15m", "1h", "4h", "1d"];
  derivedIntervalRule: "CLOSED_BARS_ONLY";
  sourceObjects: readonly IngressSourceProvenance[];
  normalizedContentDigest: string;
  barSetDigest: string;
  perBarContentDigestAlgo: "computeBarContentDigest";
  expectedBarCount: number;
  observedBarCount: number;
  intervalBoundaries: FhvUtcHalfOpenInterval;
  integrityResults: IngressIntegrityResults;
  gaps: readonly GapRecord[];
  gapPolicy: typeof FHV_GAP_POLICY_V1.policyId;
  gapPolicyResult: GapPolicyResult;
  mtfDerivation: {
    rule: "CLOSED_BARS_ONLY";
    intervals: readonly ["15m", "1h", "4h", "1d"];
  };
  pointInTimeAvailability: {
    availabilityModel: "sidecar-v3-timeline";
  };
  absentLaneRepresentation: "SIDECAR_LANE_ABSENT";
  partitions: FhvDatasetPartitionsV1;
  holdoutSeal: {
    blindDigest?: string;
    contaminationStatus: "RESERVED_SEALED_NOT_ACCESSED";
  };
  manifestVersion: number;
  supersedesDigest?: string;
  manifestSemanticDigest: string;
};

export type BuildFhvDatasetManifestInput = {
  sourceObjects: readonly IngressSourceProvenance[];
  bars: readonly Bar[];
  normalizedContentDigest: string;
  barSetDigest: string;
  integrityResults: IngressIntegrityResults;
  gaps: readonly GapRecord[];
  expectedBarCount: number;
  intervalBoundaries: FhvUtcHalfOpenInterval;
  holdoutBlindDigest?: string;
  manifestVersion?: number;
  supersedesDigest?: string;
};

export function computeFhvDatasetManifestDigest(
  manifest: Omit<FhvDatasetManifestV1, "manifestSemanticDigest">,
): string {
  return computeStableJsonDigest(manifest);
}

/** Build an immutable FHV dataset manifest (HTR-WP12). */
export function buildFhvDatasetManifest(input: BuildFhvDatasetManifestInput): FhvDatasetManifestV1 {
  const gapPolicyResult = evaluateGapPolicy(input.gaps);
  const manifestWithoutDigest: Omit<FhvDatasetManifestV1, "manifestSemanticDigest"> = {
    schemaVersion: FHV_DATASET_MANIFEST_SCHEMA_VERSION,
    venueScope: "HTX_ONLY",
    marketType: "SPOT",
    symbols: ["BTCUSDT", "ETHUSDT"],
    baseInterval: "1m",
    derivedIntervals: ["15m", "1h", "4h", "1d"],
    derivedIntervalRule: "CLOSED_BARS_ONLY",
    sourceObjects: input.sourceObjects,
    normalizedContentDigest: input.normalizedContentDigest,
    barSetDigest: input.barSetDigest,
    perBarContentDigestAlgo: "computeBarContentDigest",
    expectedBarCount: input.expectedBarCount,
    observedBarCount: input.bars.length,
    intervalBoundaries: input.intervalBoundaries,
    integrityResults: input.integrityResults,
    gaps: input.gaps,
    gapPolicy: FHV_GAP_POLICY_V1.policyId,
    gapPolicyResult,
    mtfDerivation: {
      rule: "CLOSED_BARS_ONLY",
      intervals: ["15m", "1h", "4h", "1d"],
    },
    pointInTimeAvailability: {
      availabilityModel: "sidecar-v3-timeline",
    },
    absentLaneRepresentation: "SIDECAR_LANE_ABSENT",
    partitions: FHV_DATASET_PARTITIONS_V1,
    holdoutSeal: {
      ...(input.holdoutBlindDigest ? { blindDigest: input.holdoutBlindDigest } : {}),
      contaminationStatus: "RESERVED_SEALED_NOT_ACCESSED",
    },
    manifestVersion: input.manifestVersion ?? 1,
    ...(input.supersedesDigest ? { supersedesDigest: input.supersedesDigest } : {}),
  };

  return {
    ...manifestWithoutDigest,
    manifestSemanticDigest: computeFhvDatasetManifestDigest(manifestWithoutDigest),
  };
}

export function buildFhvDatasetManifestFromBars(input: {
  bars: readonly Bar[];
  sourceObjects: readonly IngressSourceProvenance[];
  integrityResults: IngressIntegrityResults;
  gaps: readonly GapRecord[];
  expectedBarCount: number;
  intervalBoundaries: FhvUtcHalfOpenInterval;
  normalizedContentDigest: string;
  holdoutBlindDigest?: string;
  manifestVersion?: number;
  supersedesDigest?: string;
}): FhvDatasetManifestV1 {
  return buildFhvDatasetManifest({
    ...input,
    barSetDigest: computeBarSetDigest(input.bars),
  });
}
