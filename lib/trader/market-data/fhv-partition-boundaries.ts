import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";

export const FHV_OFFICIAL_PARTITION_NAMES = [
  "development",
  "walk-forward",
  "blind-holdout",
] as const;

export type FhvOfficialPartitionName = (typeof FHV_OFFICIAL_PARTITION_NAMES)[number];

export const FHV_OFFICIAL_SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;
export type FhvOfficialSymbolCode = (typeof FHV_OFFICIAL_SYMBOLS)[number];

export const FHV_SYMBOL_CODE_TO_INSTRUMENT = {
  BTCUSDT: "BTC/USDT",
  ETHUSDT: "ETH/USDT",
} as const satisfies Record<FhvOfficialSymbolCode, "BTC/USDT" | "ETH/USDT">;

export const FHV_INSTRUMENT_TO_SYMBOL_CODE = {
  "BTC/USDT": "BTCUSDT",
  "ETH/USDT": "ETHUSDT",
} as const;

export type FhvUtcHalfOpenInterval = {
  startUtc: string;
  endUtc: string;
};

export function resolveFhvCanonicalPartitionInterval(
  partition: FhvOfficialPartitionName,
): FhvUtcHalfOpenInterval {
  switch (partition) {
    case "development":
      return FHV_DATASET_PARTITIONS_V1.development;
    case "walk-forward":
      return FHV_DATASET_PARTITIONS_V1.walkForward;
    case "blind-holdout":
      return {
        startUtc: FHV_DATASET_PARTITIONS_V1.blindHoldout.startUtc,
        endUtc: FHV_DATASET_PARTITIONS_V1.blindHoldout.endUtc,
      };
    default: {
      const _exhaustive: never = partition;
      throw new Error(`[fhv] unknown partition: ${String(_exhaustive)}`);
    }
  }
}

export function assertFhvPartitionBoundariesExact(input: {
  partition: FhvOfficialPartitionName;
  startUtc: string;
  endUtc: string;
}): void {
  const canonical = resolveFhvCanonicalPartitionInterval(input.partition);
  if (input.startUtc !== canonical.startUtc || input.endUtc !== canonical.endUtc) {
    throw new Error(
      `[fhv] partition ${input.partition} boundaries must exact-match canonical ` +
        `[${canonical.startUtc}, ${canonical.endUtc})`,
    );
  }
}

export function fhvOfficialPartitionFileRelativePath(input: {
  partition: FhvOfficialPartitionName;
  symbol: FhvOfficialSymbolCode;
}): string {
  return `partitions/${input.partition}/${input.symbol}/bars.v2.ndjson`;
}

export const FHV_OFFICIAL_INTERVAL_BOUNDARIES: FhvUtcHalfOpenInterval = {
  startUtc: "2020-01-01T00:00:00.000Z",
  endUtc: "2026-01-01T00:00:00.000Z",
};

export function fhvSymbolRank(symbol: "BTC/USDT" | "ETH/USDT"): 0 | 1 {
  return symbol === "BTC/USDT" ? 0 : 1;
}
