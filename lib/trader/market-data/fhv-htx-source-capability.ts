import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HTX_API_DOC_URL,
  HTX_DEFAULT_REST_HOST,
  HTX_ENDPOINTS,
  HTX_MARKET_HISTORY_CANDLES_MAX_SIZE,
} from "@/lib/trader/connectors/htx/config";

export const FHV_HTX_SOURCE_CAPABILITY_SCHEMA_VERSION = "fhv-htx-source-capability/v1" as const;
export const FHV_HTX_SOURCE_CAPABILITY_ARTIFACT_RELATIVE_PATH =
  "control/fhv-htx-source-capability.v1.json" as const;
export const FHV_HTX_HISTORICAL_SOURCE_CAPABILITY_PROVEN =
  "FHV_HTX_HISTORICAL_SOURCE_CAPABILITY_PROVEN" as const;

export type FhvHtxSourceCapabilityV1 = Readonly<{
  schemaVersion: typeof FHV_HTX_SOURCE_CAPABILITY_SCHEMA_VERSION;
  classification: typeof FHV_HTX_HISTORICAL_SOURCE_CAPABILITY_PROVEN;
  provider: "HTX";
  marketType: "SPOT";
  endpointIdentity: string;
  archiveIdentity: null;
  exportIdentity: null;
  apiContractVersion: string;
  documentationSourceIdentity: string;
  retrievedAtUtc: string;
  btcusdtListingEvidence: string;
  ethusdtListingEvidence: string;
  intervalEvidence: "1m";
  fromToSemantics: string;
  pageRequestMaximum: number;
  rateLimitContract: string;
  retryContract: string;
  responseOrdering: "ascending_by_kline_id";
  duplicateSemantics: "dedupe_by_kline_id_keep_last";
  earliestProvenTimestamp: string;
  latestProvenTimestamp: string;
  boundedOldestRangeProbeDigest: string;
  boundedNewestRangeProbeDigest: string;
  sourceCapabilityEvidenceDigest: string;
  humanApprovedAlternativeSource?: string;
}>;

export class FhvHtxSourceCapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvHtxSourceCapabilityError";
  }
}

function computeSourceCapabilityEvidenceDigest(
  body: Omit<FhvHtxSourceCapabilityV1, "sourceCapabilityEvidenceDigest">,
): string {
  const canonical = JSON.stringify(body, Object.keys(body).sort());
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function buildFhvHtxSourceCapabilityArtifact(input: {
  retrievedAtUtc: string;
  boundedOldestRangeProbeDigest: string;
  boundedNewestRangeProbeDigest: string;
  earliestProvenTimestamp: string;
  latestProvenTimestamp: string;
  humanApprovedAlternativeSource?: string;
}): FhvHtxSourceCapabilityV1 {
  const bodyWithoutDigest = {
    schemaVersion: FHV_HTX_SOURCE_CAPABILITY_SCHEMA_VERSION,
    classification: FHV_HTX_HISTORICAL_SOURCE_CAPABILITY_PROVEN,
    provider: "HTX" as const,
    marketType: "SPOT" as const,
    endpointIdentity: `${HTX_DEFAULT_REST_HOST}${HTX_ENDPOINTS.marketHistoryCandles}`,
    archiveIdentity: null,
    exportIdentity: null,
    apiContractVersion: "spot-v1-history-candles",
    documentationSourceIdentity: HTX_API_DOC_URL,
    retrievedAtUtc: input.retrievedAtUtc,
    btcusdtListingEvidence: "btcusdt spot 1m kline history via /market/history/candles",
    ethusdtListingEvidence: "ethusdt spot 1m kline history via /market/history/candles",
    intervalEvidence: "1m" as const,
    fromToSemantics:
      "from/to unix seconds inclusive start; forward paging; ascending kline id ordering",
    pageRequestMaximum: HTX_MARKET_HISTORY_CANDLES_MAX_SIZE,
    rateLimitContract: "respect HTTP 429 with exponential backoff and jitter",
    retryContract: "max 5 retries per page; stall break when maxId does not advance",
    responseOrdering: "ascending_by_kline_id" as const,
    duplicateSemantics: "dedupe_by_kline_id_keep_last" as const,
    earliestProvenTimestamp: input.earliestProvenTimestamp,
    latestProvenTimestamp: input.latestProvenTimestamp,
    boundedOldestRangeProbeDigest: input.boundedOldestRangeProbeDigest,
    boundedNewestRangeProbeDigest: input.boundedNewestRangeProbeDigest,
    ...(input.humanApprovedAlternativeSource
      ? { humanApprovedAlternativeSource: input.humanApprovedAlternativeSource }
      : {}),
  };
  return {
    ...bodyWithoutDigest,
    sourceCapabilityEvidenceDigest: computeSourceCapabilityEvidenceDigest(bodyWithoutDigest),
  };
}

export function readFhvHtxSourceCapabilityArtifact(
  rootDir: string = process.cwd(),
): FhvHtxSourceCapabilityV1 {
  const path = join(rootDir, FHV_HTX_SOURCE_CAPABILITY_ARTIFACT_RELATIVE_PATH);
  let parsed: FhvHtxSourceCapabilityV1;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as FhvHtxSourceCapabilityV1;
  } catch (error) {
    throw new FhvHtxSourceCapabilityError(
      "SOURCE_CAPABILITY_ARTIFACT_MISSING",
      `Missing or unreadable HTX source capability artifact at ${path}: ${String(error)}`,
    );
  }
  const { sourceCapabilityEvidenceDigest, ...body } = parsed;
  const expected = computeSourceCapabilityEvidenceDigest(body);
  if (expected !== sourceCapabilityEvidenceDigest) {
    throw new FhvHtxSourceCapabilityError(
      "SOURCE_CAPABILITY_DIGEST_MISMATCH",
      "HTX source capability evidence digest mismatch.",
    );
  }
  if (parsed.classification !== FHV_HTX_HISTORICAL_SOURCE_CAPABILITY_PROVEN) {
    throw new FhvHtxSourceCapabilityError(
      "SOURCE_CAPABILITY_NOT_PROVEN",
      `HTX source capability classification must be ${FHV_HTX_HISTORICAL_SOURCE_CAPABILITY_PROVEN}`,
    );
  }
  const requiredStart = "2020-01-01T00:00:00.000Z";
  const requiredEnd = "2026-01-01T00:00:00.000Z";
  if (
    parsed.earliestProvenTimestamp > requiredStart ||
    parsed.latestProvenTimestamp < requiredEnd
  ) {
    throw new FhvHtxSourceCapabilityError(
      "SOURCE_CAPABILITY_RANGE_INSUFFICIENT",
      `HTX source capability does not prove [${requiredStart}, ${requiredEnd})`,
    );
  }
  return parsed;
}

export function assertHtxOfficialSourceCapabilityProven(
  rootDir: string = process.cwd(),
): FhvHtxSourceCapabilityV1 {
  return readFhvHtxSourceCapabilityArtifact(rootDir);
}
