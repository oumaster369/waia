import { describe, expect, it } from "vitest";

import {
  createRealityEventV2,
  createRealitySourceReportV2,
  createTruthRecordV2,
  type RealityEventV2,
  type RealitySourceReportV2,
  type TruthRecordV2,
} from "@/lib/trader/reality/v2/contracts";
import { foldRealityProjectionV2 } from "@/lib/trader/reality/v2/projection";

const ORG = "00000000-0000-4000-8000-000000000678";
const CONTEXT = { organizationId: ORG, accountId: "htx-spot-c" } as const;
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function source(
  revision: string,
  supersedesNativeRevision: string | null,
  quantity: string,
  validAtUtc: string,
  knowledgeAtUtc: string,
): RealitySourceReportV2 {
  return createRealitySourceReportV2({
    ...CONTEXT,
    sourceKind: "HTX_SPOT_FILL_REST",
    sourceNativeIdentity: {
      identityKind: "HTX_TRADE_ID",
      nativeId: "trade-c",
      nativeRevision: revision,
      supersedesNativeRevision,
    },
    attributionStatus: "ATTRIBUTED",
    subject: { subjectClass: "FILL", subjectKey: "HTX:spot:trade-c" },
    primitiveAssertion: {
      kind: "FILL",
      venueTradeId: "trade-c",
      venueOrderId: "order-c",
      symbol: "BTCUSDT",
      side: "buy",
      quantity,
      price: "25000",
      feeAmount: "0.025",
      feeAsset: "USDT",
      settlementStatus: "OBSERVED",
    },
    lineage: {
      lineageKind: "RAW_CAPTURE_V1",
      rawCaptureSourceId: "00000000-0000-4000-8000-000000067811",
      rawCaptureReceiptDigestHex: DIGEST_A,
      rawBytesDigestHex: DIGEST_B,
      storageBindingDigestHex: DIGEST_C,
    },
    provenance: {
      venue: "HTX",
      transport: "REST",
      connectorId: "htx-existing-boundary",
      connectorVersion: "v1",
      adapterVersion: "reality-htx-spot-v1",
      sourceFinalityMetadata: [],
    },
    structuralVerification: "VERIFIED",
    verificationReasonCodes: [],
    validAtUtc,
    knowledgeAtUtc,
  });
}

function truth(
  report: RealitySourceReportV2,
  supersedesTruthRecordId: string | null,
  markers: TruthRecordV2["markers"],
): TruthRecordV2 {
  return createTruthRecordV2({
    organizationId: report.organizationId,
    accountId: report.accountId,
    sourceReportId: report.sourceReportId,
    sourceReportDigestHex: report.contentDigestHex,
    sourceKind: report.sourceKind,
    sourceNativeIdentity: report.sourceNativeIdentity,
    subject: report.subject,
    primitiveAssertion: report.primitiveAssertion!,
    validAtUtc: report.validAtUtc,
    knowledgeAtUtc: report.knowledgeAtUtc,
    supersedesTruthRecordId,
    markers,
  });
}

function event(
  sequence: number,
  prior: RealityEventV2 | null,
  input: Omit<Parameters<typeof createRealityEventV2>[0],
    "organizationId" | "accountId" | "eventSequence" | "previousEventDigestHex">,
): RealityEventV2 {
  return createRealityEventV2({
    ...CONTEXT,
    ...input,
    eventSequence: String(sequence),
    previousEventDigestHex: prior?.contentDigestHex ?? null,
  });
}

function ledger() {
  const baseSource = source("1", null, "0.001", "2026-08-22T10:00:00.000Z", "2026-08-22T10:00:01.000Z");
  const disputedSource = source("1", null, "0.002", "2026-08-22T10:00:00.000Z", "2026-08-22T10:00:02.000Z");
  const correctedSource = source("2", "1", "0.003", "2026-08-22T10:00:00.000Z", "2026-08-22T10:00:04.000Z");
  const baseTruth = truth(baseSource, null, []);
  const disputedTruth = truth(disputedSource, null, ["SOURCE_CONTRADICTION"]);
  const correctedTruth = truth(correctedSource, baseTruth.truthRecordId, []);
  const observed = event(1, null, {
    eventType: "OBSERVED",
    sourceReportId: baseSource.sourceReportId,
    truthRecordId: baseTruth.truthRecordId,
    relatedTruthRecordId: null,
    quarantineEventId: null,
    reasonCodes: [],
    knowledgeAtUtc: "2026-08-22T10:00:01.000Z",
  });
  const contradicted = event(2, observed, {
    eventType: "SOURCE_CONTRADICTION",
    sourceReportId: disputedSource.sourceReportId,
    truthRecordId: disputedTruth.truthRecordId,
    relatedTruthRecordId: baseTruth.truthRecordId,
    quarantineEventId: null,
    reasonCodes: ["SOURCE_ASSERTION_CONTRADICTION"],
    knowledgeAtUtc: "2026-08-22T10:00:02.000Z",
  });
  const released = event(3, contradicted, {
    eventType: "RELEASED",
    sourceReportId: disputedSource.sourceReportId,
    truthRecordId: disputedTruth.truthRecordId,
    relatedTruthRecordId: baseTruth.truthRecordId,
    quarantineEventId: contradicted.realityEventId,
    reasonCodes: ["QUARANTINE_RESOLVED_WITHOUT_PROMOTION"],
    knowledgeAtUtc: "2026-08-22T10:00:03.000Z",
  });
  const superseded = event(4, released, {
    eventType: "SUPERSEDED",
    sourceReportId: correctedSource.sourceReportId,
    truthRecordId: correctedTruth.truthRecordId,
    relatedTruthRecordId: baseTruth.truthRecordId,
    quarantineEventId: null,
    reasonCodes: ["SOURCE_NATIVE_CORRECTION"],
    knowledgeAtUtc: "2026-08-22T10:00:04.000Z",
  });
  return {
    sources: [baseSource, disputedSource, correctedSource],
    truths: [baseTruth, disputedTruth, correctedTruth],
    events: [observed, contradicted, released, superseded],
    baseTruth,
    correctedTruth,
  };
}

describe("Reality V2 deterministic projection and replay (DEE-678)", () => {
  it("keeps last stable truth while contradiction is quarantined", () => {
    const value = ledger();
    const projection = foldRealityProjectionV2(CONTEXT, "2026-08-22T10:00:02.000Z", value);
    expect(projection.frontierSequence).toBe("2");
    expect(projection.stableEntries.map((entry) => entry.truthRecordId))
      .toEqual([value.baseTruth.truthRecordId]);
    expect(projection.uncertainties).toMatchObject([{
      marker: "SOURCE_CONTRADICTION",
      reasonCodes: ["SOURCE_ASSERTION_CONTRADICTION"],
    }]);
  });

  it("release clears uncertainty without promotion; explicit correction alone changes stable truth", () => {
    const value = ledger();
    const released = foldRealityProjectionV2(CONTEXT, "2026-08-22T10:00:03.000Z", value);
    expect(released.stableEntries[0]!.truthRecordId).toBe(value.baseTruth.truthRecordId);
    expect(released.uncertainties).toEqual([]);

    const corrected = foldRealityProjectionV2(CONTEXT, "2026-08-22T10:00:04.000Z", value);
    expect(corrected.stableEntries[0]!.truthRecordId).toBe(value.correctedTruth.truthRecordId);
    expect(corrected.frontierSequence).toBe("4");
  });

  it("is byte-deterministic for identical ledger/as-of and rejects a broken digest chain", () => {
    const value = ledger();
    const left = foldRealityProjectionV2(CONTEXT, "2026-08-22T10:00:04.000Z", value);
    const right = foldRealityProjectionV2(CONTEXT, "2026-08-22T10:00:04.000Z", {
      sources: [...value.sources].reverse(),
      truths: [...value.truths].reverse(),
      events: [...value.events].reverse(),
    });
    expect(right).toEqual(left);
    expect(right.contentDigestHex).toBe(left.contentDigestHex);

    expect(() => foldRealityProjectionV2(CONTEXT, "2026-08-22T10:00:04.000Z", {
      ...value,
      events: value.events.slice(1),
    })).toThrow("sequence/digest chain is invalid");
  });
});
