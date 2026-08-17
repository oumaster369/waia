/**
 * REAL_HTX_PREFLIGHT — read-only sample of DEVELOPMENT / WF_PREDICTIVE / WF_ECONOMIC.
 * Never samples 2025 / BLIND_HOLDOUT. amount=base, vol=quote.
 */

import { FHV_SCIENTIFIC_PARTITIONS_V1 } from "@/lib/trader/observability/fhv-partition-receipt";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import type { FhvOfficialSymbolCode } from "@/lib/trader/market-data/fhv-partition-boundaries";
import type { FhvRealHtxPageFetcher } from "@/lib/trader/market-data/fhv-real-htx-acquisition";

export const REAL_HTX_PREFLIGHT_SCHEMA = "fhv-real-htx-preflight/v1" as const;

export const REAL_HTX_PREFLIGHT_WINDOWS = [
  {
    scientificPartition: "DEVELOPMENT" as const,
    startUtc: "2020-06-01T00:00:00.000Z",
    endUtc: "2020-06-01T01:00:00.000Z",
  },
  {
    scientificPartition: "WF_PREDICTIVE" as const,
    startUtc: "2023-06-01T00:00:00.000Z",
    endUtc: "2023-06-01T01:00:00.000Z",
  },
  {
    scientificPartition: "WF_ECONOMIC" as const,
    startUtc: "2024-06-01T00:00:00.000Z",
    endUtc: "2024-06-01T01:00:00.000Z",
  },
] as const;

export type RealHtxPreflightClassification =
  | "REAL_HTX_PREFLIGHT=PASS"
  | `REAL_HTX_PREFLIGHT=BLOCKED_${string}`;

export class RealHtxPreflightError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RealHtxPreflightError";
  }
}

function assertWindowInsideScientificPartition(
  window: (typeof REAL_HTX_PREFLIGHT_WINDOWS)[number],
): void {
  const bounds = FHV_SCIENTIFIC_PARTITIONS_V1[window.scientificPartition];
  if (
    Date.parse(window.startUtc) < Date.parse(bounds.startUtc) ||
    Date.parse(window.endUtc) > Date.parse(bounds.endUtc)
  ) {
    throw new RealHtxPreflightError(
      "WINDOW_OUTSIDE_SCIENTIFIC_PARTITION",
      `${window.scientificPartition} sample is outside canonical bounds`,
    );
  }
  if (Date.parse(window.startUtc) >= Date.parse("2025-01-01T00:00:00.000Z")) {
    throw new RealHtxPreflightError(
      "HOLDOUT_SAMPLE_FORBIDDEN",
      "REAL_HTX_PREFLIGHT must not sample 2025+",
    );
  }
}

for (const window of REAL_HTX_PREFLIGHT_WINDOWS) {
  assertWindowInsideScientificPartition(window);
}

export function assertHtxAmountBaseVolQuote(row: HtxKlineRow): void {
  if (!(row.amount > 0) || !(row.vol > 0)) {
    throw new RealHtxPreflightError(
      "AMOUNT_VOL_NON_POSITIVE",
      "HTX amount (base) and vol (quote) must both be positive",
    );
  }
  const vwap = row.vol / row.amount;
  if (vwap < row.low || vwap > row.high) {
    throw new RealHtxPreflightError(
      "VWAP_OUT_OF_RANGE",
      `vol/amount VWAP ${vwap} outside [${row.low}, ${row.high}]`,
    );
  }
}

export async function runRealHtxPreflight(input: {
  fetchPage: FhvRealHtxPageFetcher;
  symbols?: readonly FhvOfficialSymbolCode[];
}): Promise<{
  schemaVersion: typeof REAL_HTX_PREFLIGHT_SCHEMA;
  classification: RealHtxPreflightClassification;
  samples: readonly {
    scientificPartition: string;
    symbol: FhvOfficialSymbolCode;
    barCount: number;
  }[];
}> {
  const symbols = input.symbols ?? (["BTCUSDT", "ETHUSDT"] as const);
  const samples: {
    scientificPartition: string;
    symbol: FhvOfficialSymbolCode;
    barCount: number;
  }[] = [];
  try {
    for (const symbol of symbols) {
      for (const window of REAL_HTX_PREFLIGHT_WINDOWS) {
        const htxSymbol = symbol === "BTCUSDT" ? "btcusdt" : "ethusdt";
        const rows = await input.fetchPage({
          symbol: htxSymbol,
          period: "1min",
          size: 60,
          from: Math.floor(Date.parse(window.startUtc) / 1000),
          to: Math.floor(Date.parse(window.endUtc) / 1000) - 1,
        });
        if (rows.length === 0) {
          throw new RealHtxPreflightError(
            "EMPTY_SAMPLE",
            `${window.scientificPartition} ${symbol} returned no rows`,
          );
        }
        for (const row of rows) {
          const openUtc = new Date(row.id * 1000).toISOString();
          if (Date.parse(openUtc) >= Date.parse("2025-01-01T00:00:00.000Z")) {
            throw new RealHtxPreflightError("HOLDOUT_SAMPLE_FORBIDDEN", "sampled 2025+ bar");
          }
          assertHtxAmountBaseVolQuote(row);
        }
        samples.push({
          scientificPartition: window.scientificPartition,
          symbol,
          barCount: rows.length,
        });
      }
    }
    return {
      schemaVersion: REAL_HTX_PREFLIGHT_SCHEMA,
      classification: "REAL_HTX_PREFLIGHT=PASS",
      samples,
    };
  } catch (error) {
    const reason = error instanceof RealHtxPreflightError ? error.code : "EVIDENCE_INVALID";
    return {
      schemaVersion: REAL_HTX_PREFLIGHT_SCHEMA,
      classification: `REAL_HTX_PREFLIGHT=BLOCKED_${reason}`,
      samples,
    };
  }
}
