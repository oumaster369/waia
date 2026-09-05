import type { TrustAsOfReceiptV1 } from "@/lib/trader/mi/trust-as-of-v1";

export const HISTORICAL_ECONOMIC_TRUST_AS_OF_V2 =
  "waia.trader.historical_economic_trust_as_of.v2" as const;

export function assertHistoricalEconomicTrustAsOfV2(input: Readonly<{
  organizationId: string;
  sourceId: string;
  economicPitAnchor: string;
  canonicalRecordAvailableAt: string;
  canonicalRecordIngestTime: string;
  epistemicRecordCutoff: string;
  ratifiedTrustRevisionId: string;
  ratifiedTrustRevisionContentDigestHex: string;
  ratifiedTrustScore: string;
  receipt: TrustAsOfReceiptV1;
}>): void {
  const pit = Date.parse(input.economicPitAnchor);
  const available = Date.parse(input.canonicalRecordAvailableAt);
  const ingest = Date.parse(input.canonicalRecordIngestTime);
  const cutoff = Date.parse(input.epistemicRecordCutoff);
  if (
    !Number.isFinite(pit) || !Number.isFinite(available) ||
    !Number.isFinite(ingest) || !Number.isFinite(cutoff) ||
    new Date(pit).toISOString() !== input.economicPitAnchor ||
    new Date(available).toISOString() !== input.canonicalRecordAvailableAt ||
    new Date(ingest).toISOString() !== input.canonicalRecordIngestTime ||
    new Date(cutoff).toISOString() !== input.epistemicRecordCutoff ||
    pit > available || available > ingest || ingest > cutoff ||
    input.receipt.id !== input.receipt.contentDigest ||
    input.receipt.organizationId !== input.organizationId ||
    input.receipt.sourceId !== input.sourceId ||
    input.receipt.anchorTimeUtc !== input.canonicalRecordAvailableAt ||
    input.receipt.status !== "RESOLVED" ||
    input.receipt.unknownReason !== null ||
    input.receipt.selectedTrustRevisionId !== input.ratifiedTrustRevisionId ||
    input.receipt.selectedContentDigest !==
      input.ratifiedTrustRevisionContentDigestHex ||
    input.receipt.selectedTrustScore !== input.ratifiedTrustScore
  ) {
    throw new Error(
      "HISTORICAL_ECONOMIC_TRUST_AS_OF_REFUSED:EXACT_RATIFIED_REVISION",
    );
  }
}
