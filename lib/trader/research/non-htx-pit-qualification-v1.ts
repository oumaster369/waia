import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import { MARKET_DATA_PROVIDER_IDS } from "@/lib/trader/market-data/observation-types";

export const NON_HTX_PIT_QUALIFICATION_SCHEMA_V1 =
  "waia.trader.non_htx_pit_qualification.v1" as const;

export const NON_HTX_PARTITIONS_V1 = Object.freeze({
  DEVELOPMENT: Object.freeze({ from: "2020-01-01T00:00:00.000Z", toExclusive: "2023-01-01T00:00:00.000Z" }),
  WALK_FORWARD_PREDICTIVE: Object.freeze({ from: "2023-01-01T00:00:00.000Z", toExclusive: "2024-01-01T00:00:00.000Z" }),
  WALK_FORWARD_ECONOMIC: Object.freeze({ from: "2024-01-01T00:00:00.000Z", toExclusive: "2025-01-01T00:00:00.000Z" }),
  BLIND_HOLDOUT_SEALED: Object.freeze({ from: "2025-01-01T00:00:00.000Z", toExclusive: null }),
});

export const NON_HTX_EXCLUDED_PROVIDER_IDS_V1 = Object.freeze([
  "binance_public", "bybit_public", "coingecko_global", "fred", "federal_reserve",
  "cme_fedwatch", "gdelt", "binance_announcements", "htx_announcements",
  "bybit_announcements", "github_releases", "infura_rpc", "trongrid_intelligence",
  "mempool_space", "sec_edgar",
] as const);

export const NON_HTX_RSS_PROVIDER_IDS_V1 = Object.freeze([
  "coindesk_rss",
  "cointelegraph_rss",
  "decrypt_rss",
] as const);

export const NON_HTX_RATIFIED_PROVIDER_IDS_V1 = Object.freeze([
  "alternative_me",
  ...NON_HTX_RSS_PROVIDER_IDS_V1,
] as const);

export const NON_HTX_RATIFIED_ENDPOINTS_V1 = Object.freeze({
  alternative_me: "https://api.alternative.me/fng/?limit=0&format=json",
  coindesk_rss: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  cointelegraph_rss: "https://cointelegraph.com/rss",
  decrypt_rss: "https://decrypt.co/feed",
} as const);

export type NonHtxQualificationReasonV1 =
  | "HISTORICAL_AVAILABLE_AT_UNPROVEN"
  | "HISTORICAL_REVISION_IDENTITY_UNPROVEN"
  | "HISTORICAL_INGEST_LINEAGE_UNPROVEN"
  | "IMMUTABLE_HISTORY_UNPROVEN"
  | "TRUTHFUL_ARCHIVE_UNAVAILABLE"
  | "HISTORICAL_EVENT_TIME_UNPROVEN"
  | "CURRENT_RSS_RECEIPT_ONLY";

export type NonHtxCapabilityEvidenceV1 = Readonly<{
  providerId: "alternative_me" | "coindesk_rss" | "cointelegraph_rss" | "decrypt_rss";
  observationKind: "fear_greed_index" | "news_headline";
  endpoint: string;
  method: "GET";
  retrievedAtUtc: string;
  rawContentDigest: string;
  eventTimePresent: boolean;
  historicalAvailableAtProven: boolean;
  historicalIngestLineageProven: boolean;
  immutableHistoryProven: boolean;
  revisionIdentityProven: boolean;
  archiveCoverage: Readonly<{ from: string | null; to: string | null }>;
}>;

export type NonHtxQualificationReceiptV1 = Readonly<{
  schemaVersion: typeof NON_HTX_PIT_QUALIFICATION_SCHEMA_V1;
  authority: "RESEARCH_NON_CAPITAL";
  providerId: NonHtxCapabilityEvidenceV1["providerId"];
  observationKind: NonHtxCapabilityEvidenceV1["observationKind"];
  disposition: "PIT_CORPUS_QUALIFIED" | "NOT_QUALIFIED";
  corpusAdmitted: boolean;
  reasonCodes: readonly NonHtxQualificationReasonV1[];
  capabilityEvidenceDigest: string;
  partitionPolicyDigest: string;
  receiptDigest: string;
}>;

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function assertIsoUtc(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an exact ISO-8601 UTC instant`);
  }
}

function assertHexDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("rawContentDigest must be lowercase SHA-256");
}

export function classifyNonHtxPartitionV1(eventTimeUtc: string):
  | "DEVELOPMENT"
  | "WALK_FORWARD_PREDICTIVE"
  | "WALK_FORWARD_ECONOMIC" {
  assertIsoUtc(eventTimeUtc, "eventTimeUtc");
  if (eventTimeUtc >= NON_HTX_PARTITIONS_V1.BLIND_HOLDOUT_SEALED.from) {
    throw new Error("BLIND_HOLDOUT_SEALED");
  }
  if (eventTimeUtc < NON_HTX_PARTITIONS_V1.DEVELOPMENT.from) {
    throw new Error("OUTSIDE_RATIFIED_PARTITIONS");
  }
  if (eventTimeUtc < NON_HTX_PARTITIONS_V1.DEVELOPMENT.toExclusive) return "DEVELOPMENT";
  if (eventTimeUtc < NON_HTX_PARTITIONS_V1.WALK_FORWARD_PREDICTIVE.toExclusive) return "WALK_FORWARD_PREDICTIVE";
  return "WALK_FORWARD_ECONOMIC";
}

export function qualifyNonHtxCapabilityV1(
  evidence: NonHtxCapabilityEvidenceV1,
): NonHtxQualificationReceiptV1 {
  assertIsoUtc(evidence.retrievedAtUtc, "retrievedAtUtc");
  assertHexDigest(evidence.rawContentDigest);
  if (evidence.endpoint !== NON_HTX_RATIFIED_ENDPOINTS_V1[evidence.providerId]) {
    throw new Error("ENDPOINT_OUTSIDE_RATIFIED_SCOPE");
  }
  if (evidence.observationKind === "fear_greed_index" && evidence.providerId !== "alternative_me") {
    throw new Error("PROVIDER_KIND_MISMATCH");
  }
  if (
    evidence.observationKind === "news_headline" &&
    !NON_HTX_RSS_PROVIDER_IDS_V1.includes(
      evidence.providerId as (typeof NON_HTX_RSS_PROVIDER_IDS_V1)[number],
    )
  ) {
    throw new Error("PROVIDER_KIND_MISMATCH");
  }

  const reasons: NonHtxQualificationReasonV1[] = [];
  if (!evidence.eventTimePresent) reasons.push("HISTORICAL_EVENT_TIME_UNPROVEN");
  if (!evidence.historicalAvailableAtProven) reasons.push("HISTORICAL_AVAILABLE_AT_UNPROVEN");
  if (!evidence.revisionIdentityProven) reasons.push("HISTORICAL_REVISION_IDENTITY_UNPROVEN");
  if (!evidence.historicalIngestLineageProven) reasons.push("HISTORICAL_INGEST_LINEAGE_UNPROVEN");
  if (!evidence.immutableHistoryProven) reasons.push("IMMUTABLE_HISTORY_UNPROVEN");
  if (evidence.observationKind === "news_headline") {
    reasons.push("CURRENT_RSS_RECEIPT_ONLY");
    if (evidence.archiveCoverage.from === null || evidence.archiveCoverage.to === null) {
      reasons.push("TRUTHFUL_ARCHIVE_UNAVAILABLE");
    }
  }
  const corpusAdmitted = evidence.eventTimePresent && reasons.length === 0;
  const body = {
    schemaVersion: NON_HTX_PIT_QUALIFICATION_SCHEMA_V1,
    authority: "RESEARCH_NON_CAPITAL" as const,
    providerId: evidence.providerId,
    observationKind: evidence.observationKind,
    disposition: corpusAdmitted ? "PIT_CORPUS_QUALIFIED" as const : "NOT_QUALIFIED" as const,
    corpusAdmitted,
    reasonCodes: Object.freeze([...reasons].sort()),
    capabilityEvidenceDigest: sha256(evidence),
    partitionPolicyDigest: sha256(NON_HTX_PARTITIONS_V1),
  };
  return Object.freeze({ ...body, receiptDigest: sha256(body) });
}

export function verifyNonHtxProviderInventoryClosureV1(): void {
  const classified = new Set<string>([
    "htx_spot",
    ...NON_HTX_RATIFIED_PROVIDER_IDS_V1,
    ...NON_HTX_EXCLUDED_PROVIDER_IDS_V1,
  ]);
  const registered = new Set<string>(MARKET_DATA_PROVIDER_IDS);
  const missing = MARKET_DATA_PROVIDER_IDS.filter((providerId) => !classified.has(providerId));
  const unknown = [...classified].filter((providerId) => !registered.has(providerId));
  if (missing.length > 0 || unknown.length > 0 || classified.size !== registered.size) {
    throw new Error(`NON_HTX_PROVIDER_INVENTORY_OPEN:missing=${missing.join(",")};unknown=${unknown.join(",")}`);
  }
}

export function verifyNonHtxQualificationReceiptV1(
  evidence: NonHtxCapabilityEvidenceV1,
  receipt: NonHtxQualificationReceiptV1,
): void {
  const expected = qualifyNonHtxCapabilityV1(evidence);
  if (canonicalJsonString(expected) !== canonicalJsonString(receipt)) {
    throw new Error("NON_HTX_QUALIFICATION_RECEIPT_MISMATCH");
  }
}
