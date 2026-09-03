import { computeSemanticSha256Hex } from "./../htr-semantic-canonical-json";

export const HISTORICAL_KNOWLEDGE_SNAPSHOT_AUTHORITY_V2 =
  "waia.trader.historical_knowledge_snapshot_authority.v2" as const;

export type HistoricalKnowledgeSnapshotAuthorityV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_KNOWLEDGE_SNAPSHOT_AUTHORITY_V2;
  organizationId: string;
  runId: string;
  symbol: string;
  pitAnchor: string;
  visibleEvidenceCount: number;
  knowledgeContentDigestHex: string;
  contentDigestHex: string;
}>;

const DIGEST = /^[0-9a-f]{64}$/;

export function buildHistoricalKnowledgeSnapshotAuthorityV2(input: Readonly<{
  organizationId: string;
  runId: string;
  symbol: string;
  pitAnchor: string;
  visibleEvidenceCount: number;
  knowledgeContentDigestHex: string;
}>): HistoricalKnowledgeSnapshotAuthorityV2 {
  const body = {
    schemaVersion: HISTORICAL_KNOWLEDGE_SNAPSHOT_AUTHORITY_V2,
    organizationId: input.organizationId,
    runId: input.runId,
    symbol: input.symbol,
    pitAnchor: input.pitAnchor,
    visibleEvidenceCount: input.visibleEvidenceCount,
    knowledgeContentDigestHex: input.knowledgeContentDigestHex,
  };
  return assertHistoricalKnowledgeSnapshotAuthorityV2(Object.freeze({
    ...body,
    contentDigestHex: computeSemanticSha256Hex(body),
  }));
}

export function assertHistoricalKnowledgeSnapshotAuthorityV2(
  value: HistoricalKnowledgeSnapshotAuthorityV2,
): HistoricalKnowledgeSnapshotAuthorityV2 {
  const expectedKeys = [
    "schemaVersion", "organizationId", "runId", "symbol", "pitAnchor",
    "visibleEvidenceCount", "knowledgeContentDigestHex", "contentDigestHex",
  ].sort();
  const { contentDigestHex, ...body } = value ?? ({} as HistoricalKnowledgeSnapshotAuthorityV2);
  const pitEpoch = Date.parse(value?.pitAnchor ?? "");
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys) ||
      value.schemaVersion !== HISTORICAL_KNOWLEDGE_SNAPSHOT_AUTHORITY_V2 ||
      !value.organizationId.trim() || !value.runId.trim() || !value.symbol.trim() ||
      !Number.isSafeInteger(pitEpoch) || new Date(pitEpoch).toISOString() !== value.pitAnchor ||
      !Number.isSafeInteger(value.visibleEvidenceCount) || value.visibleEvidenceCount < 0 ||
      !DIGEST.test(value.knowledgeContentDigestHex) || !DIGEST.test(contentDigestHex) ||
      computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error("HISTORICAL_KNOWLEDGE_SNAPSHOT_AUTHORITY_INVALID");
  }
  return value;
}
