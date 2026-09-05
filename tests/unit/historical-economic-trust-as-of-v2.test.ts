import { describe, expect, it } from "vitest";

import { assertHistoricalEconomicTrustAsOfV2 } from
  "@/lib/trader/historical-simulation-v2/economic-trust-as-of-v2";
import type { TrustAsOfReceiptV1 } from "@/lib/trader/mi/trust-as-of-v1";

const pit = "2026-01-01T00:01:00.000Z";
const recordTime = "2026-09-01T00:00:00.000Z";
const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const revisionDigest = "b".repeat(64);
const receiptDigest = "c".repeat(64);

function receipt(): TrustAsOfReceiptV1 {
  return {
    id: receiptDigest,
    contentDigest: receiptDigest,
    schemaVersion: "trust-as-of-receipt-v1",
    organizationId: "org",
    sourceId: "source",
    anchorTimeUtc: recordTime,
    status: "RESOLVED",
    unknownReason: null,
    selectedTrustRevisionId: revisionId,
    selectedRevisionSeq: 1,
    selectedContentDigest: revisionDigest,
    selectedTrustScore: "1",
    visiblePrefix: [],
    visiblePrefixDigest: "d".repeat(64),
  };
}

const expected = {
  organizationId: "org",
  sourceId: "source",
  economicPitAnchor: pit,
  canonicalRecordAvailableAt: recordTime,
  canonicalRecordIngestTime: recordTime,
  epistemicRecordCutoff: recordTime,
  ratifiedTrustRevisionId: revisionId,
  ratifiedTrustRevisionContentDigestHex: revisionDigest,
  ratifiedTrustScore: "1",
};

describe("Historical economic trust-as-of receipt V2", () => {
  it("accepts only a resolved receipt for the exact economic PIT and ratified revision", () => {
    expect(() => assertHistoricalEconomicTrustAsOfV2({
      ...expected,
      receipt: receipt(),
    })).not.toThrow();
    for (const forged of [
      { ...receipt(), anchorTimeUtc: pit },
      { ...receipt(), status: "UNKNOWN" as const, unknownReason: "NO_TRUST_HISTORY" as const,
        selectedTrustRevisionId: null, selectedRevisionSeq: null,
        selectedContentDigest: null, selectedTrustScore: null },
      { ...receipt(), selectedTrustRevisionId:
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...receipt(), selectedContentDigest: "e".repeat(64) },
      { ...receipt(), selectedTrustScore: "0.9" },
      { ...receipt(), id: "f".repeat(64) },
    ]) {
      expect(() => assertHistoricalEconomicTrustAsOfV2({
        ...expected,
        receipt: forged,
      })).toThrow("HISTORICAL_ECONOMIC_TRUST_AS_OF_REFUSED");
    }
    for (const forged of [
      { ...expected, canonicalRecordAvailableAt: pit },
      { ...expected, canonicalRecordIngestTime: "2026-08-31T23:59:59.000Z" },
      { ...expected, epistemicRecordCutoff: "2026-08-31T23:59:59.000Z" },
    ]) {
      expect(() => assertHistoricalEconomicTrustAsOfV2({
        ...forged,
        receipt: receipt(),
      })).toThrow("HISTORICAL_ECONOMIC_TRUST_AS_OF_REFUSED");
    }
  });
});
