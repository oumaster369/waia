import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const FHV_SCIENTIFIC_PARTITION_NAMES = [
  "DEVELOPMENT",
  "WF_PREDICTIVE",
  "WF_ECONOMIC",
  "BLIND_HOLDOUT",
] as const;

export type FhvScientificPartitionName = (typeof FHV_SCIENTIFIC_PARTITION_NAMES)[number];

export type FhvScientificPartitionInterval = Readonly<{
  startUtc: string;
  endUtc: string;
}>;

export const FHV_SCIENTIFIC_PARTITIONS_V1: Record<
  FhvScientificPartitionName,
  FhvScientificPartitionInterval & Readonly<{ accessPolicy: string }>
> = {
  DEVELOPMENT: {
    startUtc: "2020-01-01T00:00:00.000Z",
    endUtc: "2023-01-01T00:00:00.000Z",
    accessPolicy: "FIT_AND_CONSTRUCTION_ONLY",
  },
  WF_PREDICTIVE: {
    startUtc: "2023-01-01T00:00:00.000Z",
    endUtc: "2024-01-01T00:00:00.000Z",
    accessPolicy: "STAGE_A_PREDICTIVE_ONLY",
  },
  WF_ECONOMIC: {
    startUtc: "2024-01-01T00:00:00.000Z",
    endUtc: "2025-01-01T00:00:00.000Z",
    accessPolicy: "STAGE_B_ECONOMIC_ONLY",
  },
  BLIND_HOLDOUT: {
    startUtc: "2025-01-01T00:00:00.000Z",
    endUtc: "2026-01-01T00:00:00.000Z",
    accessPolicy: "SEALED_NOT_ACCESSED",
  },
};

export const FHV_PARTITION_RECEIPT_SCHEMA_VERSION = "fhv-partition-receipt/v1" as const;

export type FhvPartitionReceiptSymbolEvidenceV1 = Readonly<{
  symbol: "BTCUSDT" | "ETHUSDT";
  barCount: number | null;
  contentDigest: string | null;
  firstBarOpenTime: string | null;
  lastBarCloseTime: string | null;
  dataAccess: "READ" | "SEAL_ONLY";
}>;

export type FhvPartitionReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_PARTITION_RECEIPT_SCHEMA_VERSION;
  partition: FhvScientificPartitionName;
  interval: FhvScientificPartitionInterval;
  accessPolicy: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  symbolEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
  holdoutSealDigest?: string;
  partitionReceiptDigest: string;
}>;

export class FhvPartitionReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvPartitionReceiptError";
  }
}

function computePartitionReceiptDigest(
  receipt: Omit<FhvPartitionReceiptV1, "partitionReceiptDigest">,
): string {
  return computePayloadDigest(receipt);
}

export function buildFhvPartitionReceipt(input: {
  partition: FhvScientificPartitionName;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  symbolEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
  holdoutSealDigest?: string;
}): FhvPartitionReceiptV1 {
  const canonical = FHV_SCIENTIFIC_PARTITIONS_V1[input.partition];
  if (input.partition === "BLIND_HOLDOUT") {
    for (const entry of input.symbolEvidence) {
      if (entry.dataAccess !== "SEAL_ONLY") {
        throw new FhvPartitionReceiptError(
          "HOLDOUT_DATA_ACCESS_FORBIDDEN",
          "BLIND_HOLDOUT partition receipts must not read holdout bar data.",
        );
      }
      if (entry.contentDigest !== null || entry.barCount !== null) {
        throw new FhvPartitionReceiptError(
          "HOLDOUT_CONTENT_FORBIDDEN",
          "BLIND_HOLDOUT partition receipts must bind seal metadata only.",
        );
      }
    }
    if (!input.holdoutSealDigest) {
      throw new FhvPartitionReceiptError(
        "HOLDOUT_SEAL_REQUIRED",
        "BLIND_HOLDOUT partition receipt requires holdoutSealDigest.",
      );
    }
  } else {
    for (const entry of input.symbolEvidence) {
      if (entry.dataAccess !== "READ") {
        throw new FhvPartitionReceiptError(
          "PARTITION_EVIDENCE_READ_REQUIRED",
          `${input.partition} requires READ symbol evidence.`,
        );
      }
      if (!entry.contentDigest || entry.barCount === null) {
        throw new FhvPartitionReceiptError(
          "PARTITION_EVIDENCE_INCOMPLETE",
          `${input.partition} symbol evidence is incomplete.`,
        );
      }
    }
  }

  const body: Omit<FhvPartitionReceiptV1, "partitionReceiptDigest"> = {
    schemaVersion: FHV_PARTITION_RECEIPT_SCHEMA_VERSION,
    partition: input.partition,
    interval: {
      startUtc: canonical.startUtc,
      endUtc: canonical.endUtc,
    },
    accessPolicy: canonical.accessPolicy,
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    partitionsDigest: input.partitionsDigest,
    symbolEvidence: input.symbolEvidence,
    ...(input.holdoutSealDigest ? { holdoutSealDigest: input.holdoutSealDigest } : {}),
  };
  return {
    ...body,
    partitionReceiptDigest: computePartitionReceiptDigest(body),
  };
}

export function buildFhvScientificPartitionReceiptSet(input: {
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  partitionsDigest: string;
  developmentEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
  wfPredictiveEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
  wfEconomicEvidence: readonly FhvPartitionReceiptSymbolEvidenceV1[];
  holdoutSealDigest: string;
}): Record<FhvScientificPartitionName, FhvPartitionReceiptV1> {
  return {
    DEVELOPMENT: buildFhvPartitionReceipt({
      partition: "DEVELOPMENT",
      datasetContentDigest: input.datasetContentDigest,
      manifestSemanticDigest: input.manifestSemanticDigest,
      partitionsDigest: input.partitionsDigest,
      symbolEvidence: input.developmentEvidence,
    }),
    WF_PREDICTIVE: buildFhvPartitionReceipt({
      partition: "WF_PREDICTIVE",
      datasetContentDigest: input.datasetContentDigest,
      manifestSemanticDigest: input.manifestSemanticDigest,
      partitionsDigest: input.partitionsDigest,
      symbolEvidence: input.wfPredictiveEvidence,
    }),
    WF_ECONOMIC: buildFhvPartitionReceipt({
      partition: "WF_ECONOMIC",
      datasetContentDigest: input.datasetContentDigest,
      manifestSemanticDigest: input.manifestSemanticDigest,
      partitionsDigest: input.partitionsDigest,
      symbolEvidence: input.wfEconomicEvidence,
    }),
    BLIND_HOLDOUT: buildFhvPartitionReceipt({
      partition: "BLIND_HOLDOUT",
      datasetContentDigest: input.datasetContentDigest,
      manifestSemanticDigest: input.manifestSemanticDigest,
      partitionsDigest: input.partitionsDigest,
      holdoutSealDigest: input.holdoutSealDigest,
      symbolEvidence: [
        {
          symbol: "BTCUSDT",
          barCount: null,
          contentDigest: null,
          firstBarOpenTime: null,
          lastBarCloseTime: null,
          dataAccess: "SEAL_ONLY",
        },
        {
          symbol: "ETHUSDT",
          barCount: null,
          contentDigest: null,
          firstBarOpenTime: null,
          lastBarCloseTime: null,
          dataAccess: "SEAL_ONLY",
        },
      ],
    }),
  };
}

export function computeFhvScientificPartitionsDigest(): string {
  return computeStableJsonDigest(FHV_SCIENTIFIC_PARTITIONS_V1);
}

export function readFhvPartitionReceipt(receipt: FhvPartitionReceiptV1): FhvPartitionReceiptV1 {
  const { partitionReceiptDigest, ...body } = receipt;
  if (computePartitionReceiptDigest(body) !== partitionReceiptDigest) {
    throw new FhvPartitionReceiptError(
      "PARTITION_RECEIPT_DIGEST_MISMATCH",
      "Partition receipt digest mismatch.",
    );
  }
  return receipt;
}
