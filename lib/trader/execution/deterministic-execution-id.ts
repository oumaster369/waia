import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";

export class DeterministicExecutionIdCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeterministicExecutionIdCollisionError";
  }
}

const FILL_IDENTITY_SCHEMA = "htr-historical-fill/v1" as const;
const ECONOMICS_IDENTITY_SCHEMA = "htr-fill-execution-economics/v1" as const;
const EXCHANGE_TRADE_SCHEMA = "htr-fill/v1" as const;

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Content-addressed SHA-256 → UUIDv8 (version nibble 8). */
export function deterministicUuidV8(hashHex: string): string {
  const normalized = hashHex.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (normalized.length !== 64) {
    throw new Error(`[trader] deterministicUuidV8 requires 64 hex chars, got ${normalized.length}`);
  }
  const bytes = normalized.slice(0, 32);
  const timeLow = bytes.slice(0, 8);
  const timeMid = bytes.slice(8, 12);
  const timeHigh = bytes.slice(12, 16);
  const variantAndClock = bytes.slice(16, 20);
  const node = bytes.slice(20, 32);
  const versionNibble = "8";
  const clockSeqHigh = variantAndClock.slice(0, 1);
  const clockSeqLow = variantAndClock.slice(1, 4);
  const variantHigh = ((parseInt(clockSeqHigh, 16) & 0x3) | 0x8).toString(16);
  return `${timeLow}-${timeMid}-${versionNibble}${timeHigh.slice(1)}-${variantHigh}${clockSeqLow}-${node}`;
}

export function canonicalExchangeTradeId(orderId: string, fillSequence: number): string {
  return canonicalJsonString({ v: EXCHANGE_TRADE_SCHEMA, orderId, fillSequence });
}

export type HistoricalFillIdentityInput = {
  organizationId: string;
  orderId: string;
  fillSequence: number;
  sourceBarIndex: number;
};

export function computeHistoricalFillIdentityPreimage(input: HistoricalFillIdentityInput): string {
  return canonicalJsonString({
    schemaVersion: FILL_IDENTITY_SCHEMA,
    entityType: "historical-fill",
    organizationId: input.organizationId,
    orderId: input.orderId,
    fillSequence: input.fillSequence,
    sourceBarIndex: input.sourceBarIndex,
  });
}

export function computeHistoricalFillIdentityDigest(input: HistoricalFillIdentityInput): string {
  return sha256Hex(computeHistoricalFillIdentityPreimage(input));
}

export function historicalFillId(input: HistoricalFillIdentityInput): string {
  return deterministicUuidV8(computeHistoricalFillIdentityDigest(input));
}

export function fillExecutionEconomicsRowId(fillId: string): string {
  const preimage = canonicalJsonString({
    schemaVersion: ECONOMICS_IDENTITY_SCHEMA,
    entityType: "fill-execution-economics",
    fillId,
  });
  return deterministicUuidV8(sha256Hex(preimage));
}
