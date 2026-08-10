import { createHash } from "node:crypto";

import { K_MAX, M_MAX } from "@/lib/trader/intelligence/forecast-v2/constants";
import { type7QuantileFromUnsorted } from "@/lib/trader/research/benchmark/type7-quantile-v1";

export const KMGATE_VERSION = "kmgate/v1" as const;
export const KM_ANCHOR_SET_VERSION = "km-anchor-set/v1" as const;
export const KM_GLOBAL_ANCHOR_SET_VERSION = "km-global-anchor-set/v1" as const;
export const KM_WINNER_SELECT_VERSION = "km-winner-select/v1" as const;
export const KM_CONVERGENCE_RECEIPT_VERSION = "km-convergence-receipt/v1" as const;

export const KM_GRID_K = [10, 20, 30, 40, 50] as const;
export const KM_GRID_M = [20, 40, 80] as const;
export const KM_REFERENCE_K = 50 as const;
export const KM_REFERENCE_M = 80 as const;
export const KM_ANCHORS_PER_SURFACE = 4096 as const;
export const KM_GLOBAL_ANCHOR_COUNT = 16_384 as const;
export const KM_EXACT_SAMPLE_GENERATION_COUNT = 65_536_000 as const;
export const KM_COMPUTE_BUDGET_CAP = 2_000_000_000 as const;

export type KmEligibleAnchor = {
  symbol: string;
  primaryHorizonMinutes: 30 | 60;
  anchorEpochMin: number;
};

export function computeKmAnchorKey(input: {
  developmentDatasetDigestRaw32: Buffer;
  symbol: string;
  primaryHorizonMinutes: number;
  anchorEpochMin: number;
}): Buffer {
  if (input.developmentDatasetDigestRaw32.length !== 32) {
    throw new Error("[kmgate] development dataset digest must be 32 bytes");
  }
  return createHash("sha256")
    .update(input.developmentDatasetDigestRaw32)
    .update(Buffer.from(input.symbol, "ascii"))
    .update(
      Buffer.from([
        (input.primaryHorizonMinutes >>> 24) & 0xff,
        (input.primaryHorizonMinutes >>> 16) & 0xff,
        (input.primaryHorizonMinutes >>> 8) & 0xff,
        input.primaryHorizonMinutes & 0xff,
      ]),
    )
    .update(Buffer.from("kmgate/v1", "ascii"))
    .update(
      (() => {
        const buf = Buffer.alloc(8);
        buf.writeBigUInt64BE(BigInt(input.anchorEpochMin));
        return buf;
      })(),
    )
    .digest();
}

export function selectKmAnchorsV1(input: {
  developmentDatasetDigestRaw32: Buffer;
  symbol: string;
  primaryHorizonMinutes: 30 | 60;
  eligibleAnchors: readonly KmEligibleAnchor[];
}): KmEligibleAnchor[] {
  const keyed = input.eligibleAnchors
    .filter(
      (a) => a.symbol === input.symbol && a.primaryHorizonMinutes === input.primaryHorizonMinutes,
    )
    .map((anchor) => ({
      anchor,
      key: computeKmAnchorKey({
        developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
        symbol: input.symbol,
        primaryHorizonMinutes: input.primaryHorizonMinutes,
        anchorEpochMin: anchor.anchorEpochMin,
      }),
    }))
    .sort((a, b) => {
      const cmp = Buffer.compare(a.key, b.key);
      if (cmp !== 0) {
        return cmp;
      }
      return a.anchor.anchorEpochMin - b.anchor.anchorEpochMin;
    });

  if (keyed.length < KM_ANCHORS_PER_SURFACE) {
    throw new Error("KM_GATE_INSUFFICIENT_ELIGIBLE_ANCHORS");
  }

  return keyed.slice(0, KM_ANCHORS_PER_SURFACE).map((entry) => entry.anchor);
}

export function computeKmSurfaceAnchorSetDigest(input: {
  developmentDatasetDigestRaw32: Buffer;
  symbol: string;
  primaryHorizonMinutes: number;
  anchors: readonly KmEligibleAnchor[];
}): Buffer {
  const chunks: Buffer[] = [
    Buffer.from("km-anchor-set/v1", "ascii"),
    Buffer.from([0x00]),
    input.developmentDatasetDigestRaw32,
    (() => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(input.primaryHorizonMinutes);
      return buf;
    })(),
    Buffer.from(input.symbol, "ascii"),
  ];

  const ordered = [...input.anchors].sort((a, b) => {
    const keyA = computeKmAnchorKey({
      developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
      symbol: input.symbol,
      primaryHorizonMinutes: input.primaryHorizonMinutes,
      anchorEpochMin: a.anchorEpochMin,
    });
    const keyB = computeKmAnchorKey({
      developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
      symbol: input.symbol,
      primaryHorizonMinutes: input.primaryHorizonMinutes,
      anchorEpochMin: b.anchorEpochMin,
    });
    return Buffer.compare(keyA, keyB);
  });

  for (const anchor of ordered) {
    const epochBuf = Buffer.alloc(8);
    epochBuf.writeBigUInt64BE(BigInt(anchor.anchorEpochMin));
    const key = computeKmAnchorKey({
      developmentDatasetDigestRaw32: input.developmentDatasetDigestRaw32,
      symbol: input.symbol,
      primaryHorizonMinutes: input.primaryHorizonMinutes,
      anchorEpochMin: anchor.anchorEpochMin,
    });
    chunks.push(epochBuf, key);
  }

  return createHash("sha256").update(Buffer.concat(chunks)).digest();
}

export function computeKmGlobalAnchorSetDigest(surfaceDigests: readonly Buffer[]): Buffer {
  if (surfaceDigests.length !== 4) {
    throw new Error("[kmgate] expected 4 surface digests");
  }
  return createHash("sha256")
    .update(Buffer.from("km-global-anchor-set/v1", "ascii"))
    .update(Buffer.from([0x00]))
    .update(Buffer.concat(surfaceDigests))
    .digest();
}

export type KmConfigurationMetrics = {
  kConfig: number;
  mConfig: number;
  evLowerRelativeErrorP95: number;
  evBaseRelativeErrorP95: number;
  evUpperRelativeErrorP95: number;
  mcEsRelativeErrorP95: number;
  qualifies: boolean;
};

export function relativeErrorV1(candidate: number, reference: number): number {
  return Math.abs(candidate - reference) / Math.max(Math.abs(reference), 5e-5);
}

export function evaluateKmConfigurationV1(input: {
  kConfig: number;
  mConfig: number;
  perAnchorEvLowerErrors: readonly number[];
  perAnchorEvBaseErrors: readonly number[];
  perAnchorEvUpperErrors: readonly number[];
  perAnchorMcEsErrors: readonly number[];
}): KmConfigurationMetrics {
  const p95 = (values: readonly number[]) => type7QuantileFromUnsorted([...values], 0.95);

  const evLowerRelativeErrorP95 = p95(input.perAnchorEvLowerErrors);
  const evBaseRelativeErrorP95 = p95(input.perAnchorEvBaseErrors);
  const evUpperRelativeErrorP95 = p95(input.perAnchorEvUpperErrors);
  const mcEsRelativeErrorP95 = p95(input.perAnchorMcEsErrors);

  const qualifies =
    evLowerRelativeErrorP95 <= 0.01 &&
    evBaseRelativeErrorP95 <= 0.01 &&
    evUpperRelativeErrorP95 <= 0.01 &&
    mcEsRelativeErrorP95 <= 0.02;

  return {
    kConfig: input.kConfig,
    mConfig: input.mConfig,
    evLowerRelativeErrorP95,
    evBaseRelativeErrorP95,
    evUpperRelativeErrorP95,
    mcEsRelativeErrorP95,
    qualifies,
  };
}

export function selectKmWinnerV1(
  configurations: readonly KmConfigurationMetrics[],
): KmConfigurationMetrics | null {
  const qualifying = configurations.filter((c) => c.qualifies);
  if (qualifying.length === 0) {
    return null;
  }
  qualifying.sort((a, b) => {
    const sA = a.kConfig * a.mConfig;
    const sB = b.kConfig * b.mConfig;
    if (sA !== sB) {
      return sA - sB;
    }
    if (a.kConfig !== b.kConfig) {
      return a.kConfig - b.kConfig;
    }
    return a.mConfig - b.mConfig;
  });
  return qualifying[0] ?? null;
}

export function assertKmComputeBudgetV1(exactCount = KM_EXACT_SAMPLE_GENERATION_COUNT): void {
  if (exactCount > KM_COMPUTE_BUDGET_CAP) {
    throw new Error("KM_GATE_COMPUTE_BUDGET_EXCEEDED");
  }
}

export function assertNestedKmPrefixV1(kConfig: number, mConfig: number): void {
  if (kConfig > K_MAX || mConfig > M_MAX) {
    throw new Error("[kmgate] configuration exceeds K_max/M_max reference surface");
  }
}

export type KmConvergenceReceipt = {
  schemaVersion: typeof KM_CONVERGENCE_RECEIPT_VERSION;
  replicaRootFamilyIdentityDigestHex: string;
  kmGlobalAnchorSetDigestHex: string;
  referenceK: number;
  referenceM: number;
  candidateGenerationDigestsHex: readonly string[];
  configurations: readonly KmConfigurationMetrics[];
  selectedK: number | null;
  selectedM: number | null;
  alphaEpiConfigScale8: string;
  winnerSelectVersion: typeof KM_WINNER_SELECT_VERSION;
  selectedPackageGenerationIdentityDigestHex: string | null;
  selectedPackageContentDigestHex: string | null;
  evidenceSemanticDigestHex: string;
  terminalStatus: "QUALIFIED" | "NO_KM_CONFIGURATION_QUALIFIES";
};

export function buildKmConvergenceReceiptV1(input: {
  replicaRootFamilyIdentityDigestHex: string;
  kmGlobalAnchorSetDigestHex: string;
  candidateGenerationDigestsHex: readonly string[];
  configurations: readonly KmConfigurationMetrics[];
  selectedPackageGenerationIdentityDigestHex?: string | null;
  selectedPackageContentDigestHex?: string | null;
  alphaEpiConfigScale8?: string;
}): KmConvergenceReceipt {
  assertKmComputeBudgetV1();
  const winner = selectKmWinnerV1(input.configurations);
  const body = JSON.stringify({
    schema: KM_CONVERGENCE_RECEIPT_VERSION,
    replicaRootFamilyIdentityDigestHex: input.replicaRootFamilyIdentityDigestHex,
    kmGlobalAnchorSetDigestHex: input.kmGlobalAnchorSetDigestHex,
    reference: { k: KM_REFERENCE_K, m: KM_REFERENCE_M },
    candidateGenerationDigestsHex: input.candidateGenerationDigestsHex,
    configurations: input.configurations,
    winner,
    alphaEpiConfigScale8: input.alphaEpiConfigScale8 ?? "0.10000000",
    winnerSelectVersion: KM_WINNER_SELECT_VERSION,
    selectedPackageGenerationIdentityDigestHex:
      input.selectedPackageGenerationIdentityDigestHex ?? null,
    selectedPackageContentDigestHex: input.selectedPackageContentDigestHex ?? null,
  });
  const evidenceSemanticDigestHex = createHash("sha256").update(body, "utf8").digest("hex");

  return {
    schemaVersion: KM_CONVERGENCE_RECEIPT_VERSION,
    replicaRootFamilyIdentityDigestHex: input.replicaRootFamilyIdentityDigestHex,
    kmGlobalAnchorSetDigestHex: input.kmGlobalAnchorSetDigestHex,
    referenceK: KM_REFERENCE_K,
    referenceM: KM_REFERENCE_M,
    candidateGenerationDigestsHex: input.candidateGenerationDigestsHex,
    configurations: input.configurations,
    selectedK: winner?.kConfig ?? null,
    selectedM: winner?.mConfig ?? null,
    alphaEpiConfigScale8: input.alphaEpiConfigScale8 ?? "0.10000000",
    winnerSelectVersion: KM_WINNER_SELECT_VERSION,
    selectedPackageGenerationIdentityDigestHex:
      input.selectedPackageGenerationIdentityDigestHex ?? null,
    selectedPackageContentDigestHex: input.selectedPackageContentDigestHex ?? null,
    evidenceSemanticDigestHex,
    terminalStatus: winner ? "QUALIFIED" : "NO_KM_CONFIGURATION_QUALIFIES",
  };
}

export const SCIENTIFIC_ADMISSION_RECEIPT_VERSION = "scientific-admission-receipt/v1" as const;

export function buildScientificAdmissionReceiptV1(input: {
  organizationId: string;
  kmConvergenceReceipt: KmConvergenceReceipt;
  wfPartition: "WF_PREDICTIVE";
}): { contentDigest: string; receiptJson: string } {
  if (input.kmConvergenceReceipt.terminalStatus !== "QUALIFIED") {
    throw new Error("SCIENTIFIC_ADMISSION_REQUIRES_KM_QUALIFIED_WINNER");
  }
  const receipt = {
    schema: SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
    organizationId: input.organizationId,
    wfPartition: input.wfPartition,
    kmConvergenceReceipt: input.kmConvergenceReceipt,
  };
  const receiptJson = JSON.stringify(receipt);
  const contentDigest = createHash("sha256").update(receiptJson, "utf8").digest("hex");
  return { contentDigest, receiptJson };
}
