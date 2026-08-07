import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const FHV_BARS_V2_RECORD_SCHEMA_VERSION = "fhv-bars-v2-record/v1" as const;

export type FhvBarsV2Record = Readonly<{
  schemaVersion: typeof FHV_BARS_V2_RECORD_SCHEMA_VERSION;
  symbol: "BTC/USDT" | "ETH/USDT";
  interval: "1m";
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  barOpenTime: string;
  barCloseTime: string;
}>;

const CANONICAL_PROPERTY_ORDER = [
  "schemaVersion",
  "symbol",
  "interval",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "barOpenTime",
  "barCloseTime",
] as const;

export class FhvBarsV2Error extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvBarsV2Error";
  }
}

export function barToFhvBarsV2Record(bar: Bar): FhvBarsV2Record {
  if (bar.interval !== "1m") {
    throw new FhvBarsV2Error(
      "INTERVAL_UNSUPPORTED",
      `v2 record requires 1m interval (got ${bar.interval})`,
    );
  }
  if (bar.symbol !== "BTC/USDT" && bar.symbol !== "ETH/USDT") {
    throw new FhvBarsV2Error("SYMBOL_UNSUPPORTED", `v2 record symbol unsupported: ${bar.symbol}`);
  }
  return {
    schemaVersion: FHV_BARS_V2_RECORD_SCHEMA_VERSION,
    symbol: bar.symbol,
    interval: "1m",
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    barOpenTime: bar.barOpenTime,
    barCloseTime: bar.barCloseTime,
  };
}

export function serializeFhvBarsV2Record(record: FhvBarsV2Record): string {
  const ordered: Record<string, string> = {};
  for (const key of CANONICAL_PROPERTY_ORDER) {
    ordered[key] = record[key];
  }
  return `${JSON.stringify(ordered)}\n`;
}

export function parseFhvBarsV2Line(line: string, lineNumber: number): FhvBarsV2Record {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) {
    throw new FhvBarsV2Error("BLANK_LINE", `blank line at ${lineNumber}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new FhvBarsV2Error(
      "INVALID_JSON",
      `invalid JSON at line ${lineNumber}: ${String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FhvBarsV2Error("INVALID_RECORD", `non-object record at line ${lineNumber}`);
  }
  const record = parsed as Record<string, unknown>;
  for (const key of CANONICAL_PROPERTY_ORDER) {
    if (typeof record[key] !== "string") {
      throw new FhvBarsV2Error(
        "MISSING_FIELD",
        `missing or non-string ${key} at line ${lineNumber}`,
      );
    }
  }
  const extraKeys = Object.keys(record).filter(
    (key) => !CANONICAL_PROPERTY_ORDER.includes(key as never),
  );
  if (extraKeys.length > 0) {
    throw new FhvBarsV2Error(
      "NONCANONICAL_KEYS",
      `noncanonical keys at line ${lineNumber}: ${extraKeys.join(",")}`,
    );
  }
  const orderedKeys = Object.keys(record);
  for (let index = 0; index < CANONICAL_PROPERTY_ORDER.length; index += 1) {
    if (orderedKeys[index] !== CANONICAL_PROPERTY_ORDER[index]) {
      throw new FhvBarsV2Error(
        "NONCANONICAL_ORDER",
        `noncanonical property order at line ${lineNumber}`,
      );
    }
  }
  const typed = record as unknown as FhvBarsV2Record;
  if (typed.schemaVersion !== FHV_BARS_V2_RECORD_SCHEMA_VERSION) {
    throw new FhvBarsV2Error("SCHEMA_VERSION", `unsupported schemaVersion at line ${lineNumber}`);
  }
  if (typed.interval !== "1m") {
    throw new FhvBarsV2Error("INTERVAL", `interval must be 1m at line ${lineNumber}`);
  }
  if (typed.symbol !== "BTC/USDT" && typed.symbol !== "ETH/USDT") {
    throw new FhvBarsV2Error("SYMBOL", `unsupported symbol at line ${lineNumber}`);
  }
  for (const field of ["open", "high", "low", "close", "volume"] as const) {
    const value = typed[field];
    if (value.includes("NaN") || value.includes("Infinity")) {
      throw new FhvBarsV2Error("INVALID_NUMBER", `invalid decimal ${field} at line ${lineNumber}`);
    }
  }
  return typed;
}

export function fhvBarsV2RecordToBar(record: FhvBarsV2Record): Bar {
  return {
    symbol: record.symbol,
    interval: record.interval as BarInterval,
    open: record.open,
    high: record.high,
    low: record.low,
    close: record.close,
    volume: record.volume,
    barOpenTime: record.barOpenTime,
    barCloseTime: record.barCloseTime,
  };
}

export function computeFhvBarsV2RecordDigest(record: FhvBarsV2Record): string {
  return computeStableJsonDigest(record);
}
