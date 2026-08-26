import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  classifyNonHtxPartitionV1,
  qualifyNonHtxCapabilityV1,
  verifyNonHtxQualificationReceiptV1,
  verifyNonHtxProviderInventoryClosureV1,
  type NonHtxCapabilityEvidenceV1,
} from "@/lib/trader/research/non-htx-pit-qualification-v1";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const alternativeProbe: NonHtxCapabilityEvidenceV1 = {
  providerId: "alternative_me",
  observationKind: "fear_greed_index",
  endpoint: "https://api.alternative.me/fng/?limit=0&format=json",
  method: "GET",
  retrievedAtUtc: "2026-08-26T03:11:11.000Z",
  rawContentDigest: "db55e69207fa75f59a3518728da2cf91b02b6dc280a045a60b5e1b64dfa4ca33",
  eventTimePresent: true,
  historicalAvailableAtProven: false,
  historicalIngestLineageProven: false,
  immutableHistoryProven: false,
  revisionIdentityProven: false,
  archiveCoverage: {
    from: "2018-02-01T00:00:00.000Z",
    to: "2026-08-26T00:00:00.000Z",
  },
};

function evidence(overrides: Partial<NonHtxCapabilityEvidenceV1> = {}): NonHtxCapabilityEvidenceV1 {
  return {
    providerId: "alternative_me",
    observationKind: "fear_greed_index",
    endpoint: "https://api.alternative.me/fng/?limit=0&format=json",
    method: "GET",
    retrievedAtUtc: "2026-08-26T03:10:00.000Z",
    rawContentDigest: digest("bounded-probe"),
    eventTimePresent: true,
    historicalAvailableAtProven: false,
    historicalIngestLineageProven: false,
    immutableHistoryProven: false,
    revisionIdentityProven: false,
    archiveCoverage: { from: "2020-01-01T00:00:00.000Z", to: "2024-12-31T00:00:00.000Z" },
    ...overrides,
  };
}

describe("DEE-625 non-HTX PIT qualification", () => {
  it("fails Alternative.me closed when event time exists but knowability and revision truth do not", () => {
    const receipt = qualifyNonHtxCapabilityV1(evidence());
    expect(receipt.disposition).toBe("NOT_QUALIFIED");
    expect(receipt.corpusAdmitted).toBe(false);
    expect(receipt.reasonCodes).toEqual([
      "HISTORICAL_AVAILABLE_AT_UNPROVEN",
      "HISTORICAL_INGEST_LINEAGE_UNPROVEN",
      "HISTORICAL_REVISION_IDENTITY_UNPROVEN",
      "IMMUTABLE_HISTORY_UNPROVEN",
    ]);
  });

  it.each(["coindesk_rss", "cointelegraph_rss", "decrypt_rss"] as const)(
    "keeps %s current RSS receipt-only NOT_QUALIFIED",
    (providerId) => {
      const receipt = qualifyNonHtxCapabilityV1(evidence({
        providerId,
        observationKind: "news_headline",
        endpoint: {
          coindesk_rss: "https://www.coindesk.com/arc/outboundfeeds/rss/",
          cointelegraph_rss: "https://cointelegraph.com/rss",
          decrypt_rss: "https://decrypt.co/feed",
        }[providerId],
        archiveCoverage: { from: null, to: null },
      }));
      expect(receipt.disposition).toBe("NOT_QUALIFIED");
      expect(receipt.reasonCodes).toContain("TRUTHFUL_ARCHIVE_UNAVAILABLE");
    },
  );

  it("never promotes current RSS even if caller claims every PIT dimension", () => {
    const receipt = qualifyNonHtxCapabilityV1(evidence({
      providerId: "coindesk_rss",
      observationKind: "news_headline",
      endpoint: "https://www.coindesk.com/arc/outboundfeeds/rss/",
      historicalAvailableAtProven: true,
      historicalIngestLineageProven: true,
      immutableHistoryProven: true,
      revisionIdentityProven: true,
      archiveCoverage: {
        from: "2020-01-01T00:00:00.000Z",
        to: "2024-12-31T00:00:00.000Z",
      },
    }));
    expect(receipt.disposition).toBe("NOT_QUALIFIED");
    expect(receipt.reasonCodes).toEqual(["CURRENT_RSS_RECEIPT_ONLY"]);
  });

  it("fails closed when historical event time itself is absent", () => {
    const receipt = qualifyNonHtxCapabilityV1(evidence({ eventTimePresent: false }));
    expect(receipt.reasonCodes).toContain("HISTORICAL_EVENT_TIME_UNPROVEN");
    expect(receipt.corpusAdmitted).toBe(false);
  });

  it("admits only evidence with every PIT truth dimension proven", () => {
    const receipt = qualifyNonHtxCapabilityV1(evidence({
      historicalAvailableAtProven: true,
      historicalIngestLineageProven: true,
      immutableHistoryProven: true,
      revisionIdentityProven: true,
    }));
    expect(receipt.disposition).toBe("PIT_CORPUS_QUALIFIED");
    expect(receipt.corpusAdmitted).toBe(true);
  });

  it("records the bounded Alternative.me probe as receipt-only NOT_QUALIFIED", () => {
    const receipt = qualifyNonHtxCapabilityV1(alternativeProbe);
    expect(receipt.disposition).toBe("NOT_QUALIFIED");
    expect(receipt.corpusAdmitted).toBe(false);
    expect(receipt.capabilityEvidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an endpoint outside the exact ratified source surface", () => {
    expect(() => qualifyNonHtxCapabilityV1(evidence({
      endpoint: "https://example.invalid/fng",
    }))).toThrow("ENDPOINT_OUTSIDE_RATIFIED_SCOPE");
  });

  it("binds receipts to exact capability content and rejects mutation", () => {
    const source = evidence();
    const receipt = qualifyNonHtxCapabilityV1(source);
    expect(() => verifyNonHtxQualificationReceiptV1(source, receipt)).not.toThrow();
    expect(() => verifyNonHtxQualificationReceiptV1(
      { ...source, rawContentDigest: digest("mutated") }, receipt,
    )).toThrow("NON_HTX_QUALIFICATION_RECEIPT_MISMATCH");
  });

  it("freezes DEV/WF partitions and rejects blind 2025 before data use", () => {
    expect(classifyNonHtxPartitionV1("2022-12-31T23:59:59.999Z")).toBe("DEVELOPMENT");
    expect(classifyNonHtxPartitionV1("2023-06-01T00:00:00.000Z")).toBe("WALK_FORWARD_PREDICTIVE");
    expect(classifyNonHtxPartitionV1("2024-06-01T00:00:00.000Z")).toBe("WALK_FORWARD_ECONOMIC");
    expect(() => classifyNonHtxPartitionV1("2025-01-01T00:00:00.000Z")).toThrow("BLIND_HOLDOUT_SEALED");
  });

  it("is deterministic", () => {
    expect(qualifyNonHtxCapabilityV1(evidence())).toEqual(qualifyNonHtxCapabilityV1(evidence()));
  });

  it("classifies every registered provider with no silent future-provider admission", () => {
    expect(() => verifyNonHtxProviderInventoryClosureV1()).not.toThrow();
  });
});
