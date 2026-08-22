import { describe, expect, it } from "vitest";

import {
  createRealityEventV2,
  createRealityProjectionV2,
  createRealitySourceReportV2,
  createTruthRecordV2,
  type RealityPrimitiveAssertionV2,
  type RealitySourceReportV2Draft,
  validateRealityEventV2,
  validateRealityProjectionV2,
  validateRealitySourceReportV2,
  validateTruthRecordV2,
} from "@/lib/trader/reality/v2/contracts";
import {
  assertRealitySourceReportAdmissionV2,
  classifyRealitySourceKindV2,
  EXCLUDED_REALITY_SOURCE_CLASSES_V2,
} from "@/lib/trader/reality/v2/source-admission";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000675";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function fillAssertion(): RealityPrimitiveAssertionV2 {
  return {
    kind: "FILL",
    venueTradeId: "htx-trade-1",
    venueOrderId: "htx-order-1",
    symbol: "BTCUSDT",
    side: "buy",
    quantity: "0.001",
    price: "25000",
    feeAmount: "0.025",
    feeAsset: "USDT",
    settlementStatus: "OBSERVED",
  };
}

function rawFillDraft(
  overrides: Partial<RealitySourceReportV2Draft> = {},
): RealitySourceReportV2Draft {
  return {
    organizationId: ORGANIZATION_ID,
    accountId: "htx-spot-account",
    sourceKind: "HTX_SPOT_FILL_REST",
    sourceNativeIdentity: {
      identityKind: "HTX_TRADE_ID",
      nativeId: "htx-trade-1",
      nativeRevision: null,
      supersedesNativeRevision: null,
    },
    attributionStatus: "ATTRIBUTED",
    subject: { subjectClass: "FILL", subjectKey: "HTX:htx-spot-account:htx-trade-1" },
    primitiveAssertion: fillAssertion(),
    lineage: {
      lineageKind: "RAW_CAPTURE_V1",
      rawCaptureReceiptDigestHex: DIGEST_A,
      rawBytesDigestHex: DIGEST_B,
      storageBindingDigestHex: DIGEST_C,
    },
    provenance: {
      venue: "HTX",
      transport: "REST",
      connectorId: "htx-exchange-connector",
      connectorVersion: "v1",
      adapterVersion: "reality-htx-spot-v1",
      sourceFinalityMetadata: [],
    },
    structuralVerification: "VERIFIED",
    verificationReasonCodes: [],
    validAtUtc: "2026-08-22T10:00:00.000Z",
    knowledgeAtUtc: "2026-08-22T10:00:01.000Z",
    ...overrides,
  };
}

describe("Reality V2 A contracts and source admission (DEE-676)", () => {
  it("seals an immutable, content-addressed HTX fill source report deterministically", () => {
    const left = createRealitySourceReportV2(rawFillDraft());
    const right = createRealitySourceReportV2(rawFillDraft());

    expect(left).toEqual(right);
    expect(left.sourceReportId).toBe(left.contentDigestHex);
    expect(validateRealitySourceReportV2(left)).toBe(true);
    expect(() => assertRealitySourceReportAdmissionV2(left)).not.toThrow();
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.primitiveAssertion)).toBe(true);
    expect(Object.isFrozen(left.provenance.sourceFinalityMetadata)).toBe(true);
  });

  it("admits only the five Human-ratified source kinds and excludes named classes", () => {
    for (const sourceKind of [
      "EXECUTION_REPORT_V2",
      "HTX_SPOT_ORDER_REST",
      "HTX_SPOT_FILL_REST",
      "HTX_SPOT_BALANCE_REST",
      "HTX_SPOT_ACCOUNT_REST",
    ]) {
      expect(classifyRealitySourceKindV2(sourceKind)).toEqual({ status: "ADMITTED", sourceKind });
    }
    for (const sourceClass of EXCLUDED_REALITY_SOURCE_CLASSES_V2) {
      expect(classifyRealitySourceKindV2(sourceClass)).toEqual({
        status: "EXCLUDED",
        reasonCode: "SOURCE_CLASS_NOT_RATIFIED",
      });
    }
    expect(classifyRealitySourceKindV2("HTX_SPOT_PRIVATE_WEBSOCKET")).toEqual({
      status: "EXCLUDED",
      reasonCode: "SOURCE_CLASS_NOT_RATIFIED",
    });
  });

  it("requires raw HTX observations to retain encrypted raw-capture digest lineage", () => {
    const wrongLineage = createRealitySourceReportV2(rawFillDraft({
      lineage: {
        lineageKind: "EXECUTION_REPORT_V2",
        executionReportId: "00000000-0000-4000-8000-000000000676",
        executionReportDigestHex: DIGEST_A,
      },
    }));

    expect(() => assertRealitySourceReportAdmissionV2(wrongLineage)).toThrow(
      "raw HTX Reality sources require encrypted raw-capture lineage",
    );
  });

  it("rejects raw payload fields and all non-allowlisted transport metadata", () => {
    expect(() => createRealitySourceReportV2(rawFillDraft({
      provenance: {
        ...rawFillDraft().provenance,
        sourceFinalityMetadata: [{ key: "apiSecret", value: "must-not-copy" }],
      } as never,
    }))).toThrow("REST Reality provenance metadata must be empty");

    const executionDraft = rawFillDraft({
      sourceKind: "EXECUTION_REPORT_V2",
      sourceNativeIdentity: {
        identityKind: "EXECUTION_REPORT_ID",
        nativeId: "00000000-0000-4000-8000-000000000676:fill:htx-trade-1",
        nativeRevision: null,
        supersedesNativeRevision: null,
      },
      lineage: {
        lineageKind: "EXECUTION_REPORT_V2",
        executionReportId: "00000000-0000-4000-8000-000000000676",
        executionReportDigestHex: DIGEST_A,
      },
      provenance: {
        venue: "HTX",
        transport: "INTERNAL_APPEND_ONLY",
        connectorId: "execution-v2",
        connectorVersion: "execution-report/v2",
        adapterVersion: "reality-execution-v2-v1",
        sourceFinalityMetadata: [
          { key: "reportSequence", value: "1" },
          { key: "reportType", value: "FILL_REPORT_OBSERVED" },
        ],
      },
    });
    expect(() => createRealitySourceReportV2(executionDraft)).not.toThrow();
    for (const sourceFinalityMetadata of [
      [{ key: "details", value: "Bearer secret raw body" }],
      [
        { key: "reportSequence", value: "9223372036854775808" },
        { key: "reportType", value: "FILL_REPORT_OBSERVED" },
      ],
      [
        { key: "reportSequence", value: "1" },
        { key: "reportType", value: "OPAQUE_JSON" },
      ],
      [
        { key: "reportSequence", value: { rawBody: "secret" } },
        { key: "reportType", value: "FILL_REPORT_OBSERVED" },
      ],
    ]) {
      expect(() => createRealitySourceReportV2({
        ...executionDraft,
        provenance: { ...executionDraft.provenance, sourceFinalityMetadata } as never,
      })).toThrow(/exact typed metadata|canonical domain/);
    }

    expect(() => createRealitySourceReportV2(rawFillDraft({
      primitiveAssertion: {
        ...fillAssertion(),
        rawPayload: { Signature: "secret" },
      } as unknown as RealityPrimitiveAssertionV2,
    }))).toThrow("FILL assertion has unexpected fields");
  });

  it("keeps status-only FILLED as a venue event and never validates it as exact fill truth", () => {
    const statusOnly = createRealitySourceReportV2(rawFillDraft({
      sourceKind: "HTX_SPOT_ORDER_REST",
      sourceNativeIdentity: {
        identityKind: "HTX_ORDER_ID",
        nativeId: "htx-order-1",
        nativeRevision: null,
        supersedesNativeRevision: null,
      },
      subject: { subjectClass: "VENUE_EVENT", subjectKey: "HTX:htx-order-1:FILLED" },
      primitiveAssertion: {
        kind: "VENUE_EVENT",
        eventType: "VENUE_STATUS_OBSERVED",
        venueOrderId: "htx-order-1",
        status: "FILLED",
      },
    }));
    expect(() => assertRealitySourceReportAdmissionV2(statusOnly)).not.toThrow();
    expect(statusOnly.primitiveAssertion?.kind).toBe("VENUE_EVENT");

    const fabricatedFill = createRealitySourceReportV2(rawFillDraft({
      sourceKind: "HTX_SPOT_ORDER_REST",
      sourceNativeIdentity: {
        identityKind: "HTX_ORDER_ID",
        nativeId: "htx-order-1",
        nativeRevision: null,
        supersedesNativeRevision: null,
      },
    }));
    expect(() => assertRealitySourceReportAdmissionV2(fabricatedFill)).toThrow(
      "source kind cannot assert this Reality subject class",
    );
  });

  it("represents structurally unverifiable input without an invented assertion", () => {
    const report = createRealitySourceReportV2(rawFillDraft({
      sourceNativeIdentity: null,
      attributionStatus: "UNATTRIBUTED",
      primitiveAssertion: null,
      structuralVerification: "UNVERIFIABLE",
      verificationReasonCodes: ["MISSING_SOURCE_NATIVE_ID"],
    }));
    expect(report.primitiveAssertion).toBeNull();
    expect(report.attributionStatus).toBe("UNATTRIBUTED");
    expect(validateRealitySourceReportV2(report)).toBe(true);
    expect(() => assertRealitySourceReportAdmissionV2(report)).not.toThrow();
  });

  it("allows a base revision and requires an explicit distinct prior revision for correction", () => {
    const base = createRealitySourceReportV2(rawFillDraft({
      sourceNativeIdentity: {
        identityKind: "HTX_TRADE_ID",
        nativeId: "htx-trade-1",
        nativeRevision: "1",
        supersedesNativeRevision: null,
      },
    }));
    expect(base.sourceNativeIdentity?.nativeRevision).toBe("1");

    expect(() => createRealitySourceReportV2(rawFillDraft({
      sourceNativeIdentity: {
        identityKind: "HTX_TRADE_ID",
        nativeId: "htx-trade-1",
        nativeRevision: null,
        supersedesNativeRevision: "1",
      },
    }))).toThrow("source-native correction requires distinct current and superseded revisions");

    const corrected = createRealitySourceReportV2(rawFillDraft({
      sourceNativeIdentity: {
        identityKind: "HTX_TRADE_ID",
        nativeId: "htx-trade-1",
        nativeRevision: "2",
        supersedesNativeRevision: "1",
      },
    }));
    expect(corrected.sourceNativeIdentity?.supersedesNativeRevision).toBe("1");
  });

  it("seals truth, event-chain, and exact-frontier projection contracts", () => {
    const source = createRealitySourceReportV2(rawFillDraft());
    const truth = createTruthRecordV2({
      organizationId: source.organizationId,
      accountId: source.accountId,
      sourceReportId: source.sourceReportId,
      sourceReportDigestHex: source.contentDigestHex,
      sourceKind: source.sourceKind,
      sourceNativeIdentity: source.sourceNativeIdentity,
      subject: source.subject,
      primitiveAssertion: source.primitiveAssertion!,
      validAtUtc: source.validAtUtc,
      knowledgeAtUtc: source.knowledgeAtUtc,
      supersedesTruthRecordId: null,
      markers: [],
    });
    const event = createRealityEventV2({
      organizationId: source.organizationId,
      accountId: source.accountId,
      eventSequence: "1",
      eventType: "OBSERVED",
      sourceReportId: source.sourceReportId,
      truthRecordId: truth.truthRecordId,
      relatedTruthRecordId: null,
      reasonCodes: [],
      knowledgeAtUtc: source.knowledgeAtUtc,
      previousEventDigestHex: null,
    });
    const projection = createRealityProjectionV2({
      organizationId: source.organizationId,
      accountId: source.accountId,
      knowledgeAsOfUtc: source.knowledgeAtUtc,
      frontierSequence: "1",
      frontierEventDigestHex: event.contentDigestHex,
      stableEntries: [{
        subject: truth.subject,
        truthRecordId: truth.truthRecordId,
        sourceReportId: source.sourceReportId,
        validAtUtc: truth.validAtUtc,
        knowledgeAtUtc: truth.knowledgeAtUtc,
        primitiveAssertion: truth.primitiveAssertion,
      }],
      uncertainties: [],
    });

    expect(validateTruthRecordV2(truth)).toBe(true);
    expect(validateRealityEventV2(event)).toBe(true);
    expect(validateRealityProjectionV2(projection)).toBe(true);
    expect(truth.truthRecordId).toBe(truth.contentDigestHex);
    expect(event.realityEventId).toBe(event.contentDigestHex);
    expect(projection.projectionId).toBe(projection.contentDigestHex);
  });

  it("rejects invalid balance arithmetic, knowledge-before-valid time, and non-Reality markers", () => {
    expect(() => createRealitySourceReportV2(rawFillDraft({
      sourceKind: "HTX_SPOT_BALANCE_REST",
      sourceNativeIdentity: {
        identityKind: "HTX_BALANCE_SNAPSHOT_ID",
        nativeId: "balance-snapshot-1",
        nativeRevision: null,
        supersedesNativeRevision: null,
      },
      subject: { subjectClass: "BALANCE", subjectKey: "HTX:htx-spot-account:BTC" },
      primitiveAssertion: { kind: "BALANCE", asset: "BTC", available: "1", locked: "1", total: "1" },
    }))).toThrow("balance total must equal available plus locked");

    expect(() => createRealitySourceReportV2(rawFillDraft({
      knowledgeAtUtc: "2026-08-22T09:59:59.000Z",
    }))).toThrow("knowledge time cannot precede source-asserted valid time");

    const source = createRealitySourceReportV2(rawFillDraft());
    expect(() => createTruthRecordV2({
      organizationId: source.organizationId,
      accountId: source.accountId,
      sourceReportId: source.sourceReportId,
      sourceReportDigestHex: source.contentDigestHex,
      sourceKind: source.sourceKind,
      sourceNativeIdentity: source.sourceNativeIdentity,
      subject: source.subject,
      primitiveAssertion: source.primitiveAssertion!,
      validAtUtc: source.validAtUtc,
      knowledgeAtUtc: source.knowledgeAtUtc,
      supersedesTruthRecordId: null,
      markers: ["DIVERGENCE" as never],
    })).toThrow("markers must be sorted unique Reality-owned markers");
  });
});
