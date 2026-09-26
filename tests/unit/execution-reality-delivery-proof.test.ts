import { describe, expect, it } from "vitest";
import { createExecutionReportV2 } from "@/lib/trader/execution/v2/contracts";
import { createRealityEventV2, createRealitySourceReportV2, createTruthRecordV2 } from "@/lib/trader/reality/v2/contracts";
import { routeRealityIngressV2 } from "@/lib/trader/reality/v2/ingress";
import { foldRealityProjectionV2, type RealityLedgerV2 } from "@/lib/trader/reality/v2/projection";
import { assertDeliveryDraftCapacity, assertDeliveryLedger, assertDeliveryReportPrefix, captureDeliveryInput,
  capturedReportHead, checkDeliveryCapacity, deliveryUnsignedInteger, deliveryWitness, findDeliverySource,
} from "@/lib/trader/reality/v2/execution-report-delivery-proof";
import { isRealitySemanticDuplicateV2 } from "@/lib/trader/reality/v2/source-equivalence";

const scope = { organizationId: "00000000-0000-4000-8000-000000001122", accountId: "fixture-account" };
const input = { ...scope, executionAttemptId: "00000000-0000-4000-8000-000000001123" };
const report = createExecutionReportV2({ ...input, executionReportId: "00000000-0000-4000-8000-000000001124",
  executionAttemptContentDigestHex: "a".repeat(64), reportSequence: "1", reportType: "ATTEMPT_BOUND",
  source: "EXECUTION", rawObservation: {}, venueOrderId: null, observedAtUtc: "2026-09-20T10:00:00.000Z",
  previousReportDigestHex: null });
const route = routeRealityIngressV2({ kind: "EXECUTION_REPORT_V2", report });
if (route.status !== "ADMITTED") throw new Error("fixture route failed");
const draft = route.drafts[0]!;
const source = createRealitySourceReportV2({ ...draft, ...scope, knowledgeAtUtc: "2026-09-20T10:00:01.000Z" });
const truth = createTruthRecordV2({ ...scope, sourceReportId: source.sourceReportId, sourceReportDigestHex: source.contentDigestHex,
  sourceKind: source.sourceKind, sourceNativeIdentity: source.sourceNativeIdentity, subject: source.subject,
  primitiveAssertion: source.primitiveAssertion!, validAtUtc: source.validAtUtc, knowledgeAtUtc: source.knowledgeAtUtc,
  supersedesTruthRecordId: null, markers: [] });
const event = createRealityEventV2({ ...scope, eventSequence: "1", eventType: "OBSERVED", sourceReportId: source.sourceReportId,
  truthRecordId: truth.truthRecordId, relatedTruthRecordId: null, quarantineEventId: null, reasonCodes: [],
  knowledgeAtUtc: "2026-09-20T10:00:02.000Z", previousEventDigestHex: null });
const ledger: RealityLedgerV2 = { sources: [source], truths: [truth], events: [event] };
const projection = foldRealityProjectionV2(scope, event.knowledgeAtUtc, ledger);

describe("DEE1122 bounded report delivery proof", () => {
  it("captures exact identity values without retaining mutable input", () => {
    const mutable = { ...input }; const frozen = captureDeliveryInput(mutable);
    mutable.accountId = "other"; expect(frozen).toEqual(input); expect(Object.isFrozen(frozen)).toBe(true);
  });
  it.each([
    { ...input, organizationId: input.organizationId.toUpperCase().replace("1122", "ABCD") },
    { ...input, organizationId: `{${input.organizationId}}` },
    { ...input, organizationId: input.organizationId.replaceAll("-", "") },
    { ...input, accountId: " fixture-account" }, { ...input, accountId: "" },
    { ...input, reports: [report] }, { ...input, executionAttemptId: "not-an-id" },
  ])("refuses alias or extra input before scope use: %j", (value) => {
    expect(() => captureDeliveryInput(value)).toThrow("INVALID_INPUT");
  });
  it("keeps reportless and positive head states distinct", () => {
    expect(capturedReportHead("1", null)).toBe("0");
    expect(capturedReportHead("2", report.contentDigestHex)).toBe("1");
    expect(() => capturedReportHead("1", report.contentDigestHex)).toThrow("REPORT_PREFIX_INVALID");
    expect(() => capturedReportHead("2", null)).toThrow("REPORT_PREFIX_INVALID");
  });
  it.each(["", "0", "01", "-1", "1.0", "9223372036854775808"])("refuses malformed next sequence %s", (head) => {
    expect(() => capturedReportHead(head, null)).toThrow("REPORT_PREFIX_INVALID");
  });
  it.each(["9007199254740993", "9223372036854775807"])("refuses huge complete prefix %s with exact bigint detail", (next) => {
    try { capturedReportHead(next, report.contentDigestHex); throw new Error("must refuse"); }
    catch (error) { expect(error).toMatchObject({ code: "CAPACITY_EXCEEDED", detail: {
      bound: "reports", observed: (BigInt(next) - 1n).toString(), maximum: "256" } }); }
  });
  it("admits exact256 and refuses257 before any report load", () => {
    expect(capturedReportHead("257", report.contentDigestHex)).toBe("256");
    expect(() => capturedReportHead("258", report.contentDigestHex)).toThrow("CAPACITY_EXCEEDED");
  });
  it("checks exact prefix seals/scope/sequence/previous digest and head", () => {
    expect(() => assertDeliveryReportPrefix(input, report.executionAttemptContentDigestHex, "1", report.contentDigestHex, [report])).not.toThrow();
    expect(() => assertDeliveryReportPrefix(input, report.executionAttemptContentDigestHex, "0", null, [])).not.toThrow();
    for (const reports of [[], [{ ...report, accountId: "other" }], [{ ...report, rawObservation: { modified: true } }]]) {
      expect(() => assertDeliveryReportPrefix(input, report.executionAttemptContentDigestHex, "1", report.contentDigestHex, reports)).toThrow("REPORT_PREFIX_INVALID");
    }
    expect(() => assertDeliveryReportPrefix(input, "b".repeat(64), "1", report.contentDigestHex, [report])).toThrow();
    expect(() => assertDeliveryReportPrefix(input, report.executionAttemptContentDigestHex, "1", "b".repeat(64), [report])).toThrow();
  });
  it("reserves512 drafts conservatively, refuses513, and checks exact integer byte bounds", () => {
    expect(() => assertDeliveryDraftCapacity(Array(512).fill(draft))).not.toThrow();
    expect(() => assertDeliveryDraftCapacity(Array(513).fill(draft))).toThrow("CAPACITY_EXCEEDED");
    expect(() => checkDeliveryCapacity("bytes", 16_777_216n, 16_777_216)).not.toThrow();
    expect(() => checkDeliveryCapacity("bytes", 16_777_217n, 16_777_216)).toThrow();
    expect(deliveryUnsignedInteger("9007199254740993")).toBe(9_007_199_254_740_993n);
    expect(() => assertDeliveryDraftCapacity([{ ...draft, provenance: { ...draft.provenance,
      connectorId: "x".repeat(65_536) } }])).toThrow("CAPACITY_EXCEEDED");
  });
  it("admits genuinely empty baseline and exact stored fold", () => {
    expect(assertDeliveryLedger(scope, { sources: [], truths: [], events: [] }, null)).toBe(null);
    expect(assertDeliveryLedger(scope, ledger, projection)).toEqual(projection);
    expect(deliveryWitness(source, ledger)).toMatchObject({ kind: "OWN_TRUTH", admissionEventId: event.realityEventId });
    expect(findDeliverySource(scope, draft, ledger.sources)).toEqual(source);
  });
  it("refuses missing/stale/body-corrupt stored projection before any duplicate writer", () => {
    expect(() => assertDeliveryLedger(scope, ledger, null)).toThrow("REALITY_BASELINE_INVALID");
    expect(() => assertDeliveryLedger(scope, ledger, { ...projection, stableEntries: [] })).toThrow("REALITY_BASELINE_INVALID");
    const stale = foldRealityProjectionV2(scope, source.validAtUtc, { sources: [], truths: [], events: [] });
    expect(() => assertDeliveryLedger(scope, ledger, stale)).toThrow("REALITY_BASELINE_INVALID");
  });
  it("refuses no-frontier artifacts instead of silently repairing source/truth", () => {
    for (const value of [{ ...ledger, events: [] }, { sources: [source], truths: [], events: [] }]) {
      expect(() => assertDeliveryLedger(scope, value, null)).toThrow("DELIVERY_INCOMPLETE");
    }
    expect(() => deliveryWitness(source, { ...ledger, events: [] })).toThrow("DELIVERY_INCOMPLETE");
  });
  it("checks full event chain and cross-source links despite self-consistent new seals", () => {
    const { schemaVersion, truthRecordId, contentDigestHex, ...original } = truth;
    void schemaVersion; void truthRecordId; void contentDigestHex;
    const orphan = createTruthRecordV2({ ...original, sourceReportId: "b".repeat(64), sourceReportDigestHex: "b".repeat(64) });
    expect(() => assertDeliveryLedger(scope, { ...ledger, truths: [orphan] }, projection)).toThrow("REALITY_BASELINE_INVALID");
    expect(() => assertDeliveryLedger(scope, { ...ledger, events: [{ ...event, previousEventDigestHex: "b".repeat(64) }] }, projection)).toThrow();
  });
  it("admits a later semantic alias only through an admitted witness, without a new event", () => {
    // General ingester compatibility: current Execution adapter gives a report-
    // derived native ID; this fixture does not claim a second live report producer.
    const alias = createRealitySourceReportV2({ ...draft, ...scope, knowledgeAtUtc: "2026-09-20T10:00:03.000Z" });
    const withAlias = { ...ledger, sources: [source, alias] };
    expect(isRealitySemanticDuplicateV2(alias, truth)).toBe(true);
    expect(assertDeliveryLedger(scope, withAlias, projection)).toEqual(projection);
    expect(deliveryWitness(alias, withAlias)).toMatchObject({ kind: "SEMANTIC_ALIAS", admissionEventId: event.realityEventId });
    expect(() => deliveryWitness(alias, { ...withAlias, events: [] })).toThrow("DELIVERY_INCOMPLETE");
    expect(isRealitySemanticDuplicateV2({ ...alias, subject: { ...alias.subject, subjectKey: "other" } }, truth)).toBe(false);
  });
  it("refuses unexplained source-only occurrence in a nonempty account", () => {
    const extra = createRealitySourceReportV2({ ...draft, ...scope, knowledgeAtUtc: "2026-09-20T10:00:03.000Z",
      sourceNativeIdentity: { ...source.sourceNativeIdentity!, nativeId: "other" } });
    expect(() => deliveryWitness(extra, { ...ledger, sources: [source, extra] })).toThrow("DELIVERY_INCOMPLETE");
  });
});
