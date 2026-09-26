import { canonicalJsonString } from "@/lib/trader/research/digest";
import { validateExecutionReportV2, type ExecutionReportV2 } from "@/lib/trader/execution/v2/contracts";
import { createRealitySourceReportV2, validateRealityEventV2, validateRealityProjectionV2,
  validateRealitySourceReportV2, validateTruthRecordV2,
  type RealityProjectionV2, type RealitySourceReportV2, type TruthRecordV2,
} from "./contracts";
import { foldRealityProjectionV2, type RealityLedgerV2 } from "./projection";
import type { AppendRealitySourceReportV2Input, RealityAccountContext } from "./repository-postgres";
import { isRealitySemanticDuplicateV2 } from "./source-equivalence";

export const EXECUTION_REALITY_DELIVERY_LIMITS = Object.freeze({
  reports: 256, sealedRowBytes: 1_048_576, reportRowBytes: 1_048_576,
  reportTotalBytes: 8_388_608, drafts: 512, draftBytes: 65_536,
  draftTotalBytes: 4_194_304, ledgerRows: 4_096, ledgerRowBytes: 1_048_576,
  ledgerTotalBytes: 33_554_432, projectionBytes: 16_777_216,
});
export type ExecutionRealityDeliveryInput = Readonly<{
  organizationId: string; accountId: string; executionAttemptId: string;
}>;
export type ExecutionRealityDeliveryCode =
  | "INVALID_INPUT" | "TRANSACTION_OWNER_REQUIRED" | "ATTEMPT_NOT_FOUND"
  | "SOURCE_BINDING_INVALID" | "UNSUPPORTED_SOURCE_SCOPE" | "REPORT_PREFIX_INVALID"
  | "CAPACITY_EXCEEDED" | "REALITY_BASELINE_INVALID" | "DELIVERY_INCOMPLETE";
export class ExecutionRealityDeliveryRefusal extends Error {
  constructor(readonly code: ExecutionRealityDeliveryCode,
    readonly detail?: Readonly<{ bound: string; observed: string; maximum: string }>) {
    super(code);
    this.name = "ExecutionRealityDeliveryRefusal";
  }
}
export function refuseDelivery(code: ExecutionRealityDeliveryCode): never {
  throw new ExecutionRealityDeliveryRefusal(code);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
export function captureDeliveryInput(input: ExecutionRealityDeliveryInput): ExecutionRealityDeliveryInput {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).sort().join() !== "accountId,executionAttemptId,organizationId") refuseDelivery("INVALID_INPUT");
  const { organizationId, accountId, executionAttemptId } = input;
  if (typeof organizationId !== "string" || !UUID.test(organizationId) ||
    typeof executionAttemptId !== "string" || !UUID.test(executionAttemptId) ||
    typeof accountId !== "string" || !accountId || accountId !== accountId.trim()) refuseDelivery("INVALID_INPUT");
  return Object.freeze({ organizationId, accountId, executionAttemptId });
}
export function deliveryUnsignedInteger(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,18})$/.test(value)) refuseDelivery("REPORT_PREFIX_INVALID");
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) refuseDelivery("REPORT_PREFIX_INVALID");
  return parsed;
}
export function checkDeliveryCapacity(bound: string, observed: bigint, maximum: number): void {
  if (observed < 0n || observed > BigInt(maximum)) {
    throw new ExecutionRealityDeliveryRefusal("CAPACITY_EXCEEDED", {
      bound, observed: observed.toString(), maximum: maximum.toString(),
    });
  }
}
export function capturedReportHead(next: string, digest: string | null): string {
  const parsed = deliveryUnsignedInteger(next);
  if (parsed < 1n || (parsed === 1n ? digest !== null : typeof digest !== "string" || !DIGEST.test(digest))) {
    refuseDelivery("REPORT_PREFIX_INVALID");
  }
  const head = parsed - 1n;
  checkDeliveryCapacity("reports", head, EXECUTION_REALITY_DELIVERY_LIMITS.reports);
  return head.toString();
}
export function assertDeliveryReportPrefix(input: ExecutionRealityDeliveryInput,
  attemptDigest: string, head: string, digest: string | null, reports: readonly ExecutionReportV2[]): void {
  if (BigInt(reports.length) !== deliveryUnsignedInteger(head)) refuseDelivery("REPORT_PREFIX_INVALID");
  let previous: string | null = null;
  for (const [index, report] of reports.entries()) {
    if (!validateExecutionReportV2(report) || report.organizationId !== input.organizationId ||
      report.accountId !== input.accountId || report.executionAttemptId !== input.executionAttemptId ||
      report.executionAttemptContentDigestHex !== attemptDigest || report.reportSequence !== String(index + 1) ||
      report.previousReportDigestHex !== previous) refuseDelivery("REPORT_PREFIX_INVALID");
    previous = report.contentDigestHex;
  }
  if (previous !== digest) refuseDelivery("REPORT_PREFIX_INVALID");
}
export function assertDeliveryDraftCapacity(drafts: readonly AppendRealitySourceReportV2Input[]): void {
  const limits = EXECUTION_REALITY_DELIVERY_LIMITS;
  checkDeliveryCapacity("drafts", BigInt(drafts.length), limits.drafts);
  let total = 0n;
  for (const draft of drafts) {
    const bytes = BigInt(new TextEncoder().encode(canonicalJsonString(draft)).length);
    checkDeliveryCapacity("draftBytes", bytes, limits.draftBytes);
    total += bytes;
  }
  checkDeliveryCapacity("draftTotalBytes", total, limits.draftTotalBytes);
}
function equal(left: unknown, right: unknown): boolean {
  return canonicalJsonString(left) === canonicalJsonString(right);
}
function exactTruthSource(truth: TruthRecordV2, source: RealitySourceReportV2 | undefined): boolean {
  return !!source && source.structuralVerification === "VERIFIED" &&
    truth.sourceReportDigestHex === source.contentDigestHex && truth.sourceKind === source.sourceKind &&
    equal(truth.sourceNativeIdentity, source.sourceNativeIdentity) && equal(truth.subject, source.subject) &&
    equal(truth.primitiveAssertion, source.primitiveAssertion) && truth.validAtUtc === source.validAtUtc &&
    truth.knowledgeAtUtc === source.knowledgeAtUtc;
}
/** Stored-reader consistency only. Existing SQL guards retain source authority. */
export function assertDeliveryLedger(scope: RealityAccountContext, ledger: RealityLedgerV2,
  projection: RealityProjectionV2 | null): RealityProjectionV2 | null {
  try {
    const scoped = (value: { organizationId: string; accountId: string }) =>
      value.organizationId === scope.organizationId && value.accountId === scope.accountId;
    if (ledger.sources.some((s) => !scoped(s) || !validateRealitySourceReportV2(s)) ||
      ledger.truths.some((t) => !scoped(t) || !validateTruthRecordV2(t)) ||
      ledger.events.some((e) => !scoped(e) || !validateRealityEventV2(e))) refuseDelivery("REALITY_BASELINE_INVALID");
    const sources = new Map(ledger.sources.map((s) => [s.sourceReportId, s]));
    const truths = new Map(ledger.truths.map((t) => [t.truthRecordId, t]));
    if (sources.size !== ledger.sources.length || truths.size !== ledger.truths.length ||
      new Set(ledger.events.map((e) => e.realityEventId)).size !== ledger.events.length ||
      ledger.truths.some((t) => !exactTruthSource(t, sources.get(t.sourceReportId)))) refuseDelivery("REALITY_BASELINE_INVALID");
    for (const [index, event] of ledger.events.entries()) {
      if (event.eventSequence !== String(index + 1) || (index > 0 &&
        event.knowledgeAtUtc < ledger.events[index - 1]!.knowledgeAtUtc)) refuseDelivery("REALITY_BASELINE_INVALID");
      const source = sources.get(event.sourceReportId);
      const truth = event.truthRecordId === null ? null : truths.get(event.truthRecordId);
      const related = event.relatedTruthRecordId === null ? null : truths.get(event.relatedTruthRecordId);
      if (!source || event.knowledgeAtUtc < source.knowledgeAtUtc ||
        (event.truthRecordId !== null && (!truth || truth.sourceReportId !== source.sourceReportId)) ||
        (event.relatedTruthRecordId !== null && !related) ||
        (truth && truth.knowledgeAtUtc > event.knowledgeAtUtc) ||
        (related && related.knowledgeAtUtc > event.knowledgeAtUtc)) refuseDelivery("REALITY_BASELINE_INVALID");
      if (event.eventType === "OBSERVED" && (!truth || related || truth.markers.length || truth.supersedesTruthRecordId)) refuseDelivery("REALITY_BASELINE_INVALID");
      if (event.eventType === "SUPERSEDED" && (!truth || !related || truth.markers.length || related.markers.length ||
        !equal(truth.subject, related.subject))) refuseDelivery("REALITY_BASELINE_INVALID");
      if (event.eventType === "SOURCE_CONTRADICTION" && (!truth || !related ||
        !equal(truth.markers, ["SOURCE_CONTRADICTION"]) || related.markers.length ||
        !equal(truth.subject, related.subject))) refuseDelivery("REALITY_BASELINE_INVALID");
      if (event.eventType === "QUARANTINED") {
        const native = source.sourceNativeIdentity;
        const unverifiable = source.structuralVerification === "UNVERIFIABLE" &&
          !event.reasonCodes.includes("CORRECTION_TARGET_NOT_FOUND");
        const correction = source.structuralVerification === "VERIFIED" && source.attributionStatus === "ATTRIBUTED" &&
          native?.nativeRevision !== null && native?.nativeRevision !== undefined &&
          native.supersedesNativeRevision !== null && equal(event.reasonCodes, ["CORRECTION_TARGET_NOT_FOUND"]);
        if (truth || related || !event.reasonCodes.length || (!unverifiable && !correction)) refuseDelivery("REALITY_BASELINE_INVALID");
      }
    }
    const head = ledger.events.at(-1);
    if (!head) {
      if (ledger.sources.length || ledger.truths.length || projection) refuseDelivery("DELIVERY_INCOMPLETE");
      return null;
    }
    const replayed = foldRealityProjectionV2(scope, head.knowledgeAtUtc, ledger);
    if (!projection || !validateRealityProjectionV2(projection) || !equal(replayed, projection)) refuseDelivery("REALITY_BASELINE_INVALID");
    return replayed;
  } catch (error) {
    if (error instanceof ExecutionRealityDeliveryRefusal) throw error;
    refuseDelivery("REALITY_BASELINE_INVALID");
  }
}
export type DeliveryWitness = Readonly<{
  sourceReportId: string;
  sourceReportDigestHex: string;
  knowledgeAtUtc: string;
  kind: "OWN_TRUTH" | "OWN_CONTRADICTION" | "SOURCE_QUARANTINE" | "SEMANTIC_ALIAS";
  truthRecordId: string | null;
  admissionEventId: string;
}>;
/** Invoke only after the bounded complete ledger has passed assertDeliveryLedger. */
export function deliveryWitness(source: RealitySourceReportV2, ledger: RealityLedgerV2): DeliveryWitness {
  const admission = (truth: TruthRecordV2) => ledger.events.find((event) =>
    event.sourceReportId === truth.sourceReportId && event.truthRecordId === truth.truthRecordId &&
    ["OBSERVED", "SUPERSEDED", "SOURCE_CONTRADICTION"].includes(event.eventType));
  const ownTruths = ledger.truths.filter((t) => t.sourceReportId === source.sourceReportId)
    .sort((a, b) => a.truthRecordId.localeCompare(b.truthRecordId));
  for (const truth of ownTruths) {
    const event = admission(truth);
    if (event && exactTruthSource(truth, source)) return Object.freeze({
      sourceReportId: source.sourceReportId, sourceReportDigestHex: source.contentDigestHex,
      knowledgeAtUtc: source.knowledgeAtUtc,
      kind: event.eventType === "SOURCE_CONTRADICTION" ? "OWN_CONTRADICTION" : "OWN_TRUTH",
      truthRecordId: truth.truthRecordId, admissionEventId: event.realityEventId,
    });
  }
  const quarantine = ledger.events.find((e) => e.sourceReportId === source.sourceReportId &&
    e.eventType === "QUARANTINED" && e.truthRecordId === null && e.relatedTruthRecordId === null);
  if (quarantine) return Object.freeze({ sourceReportId: source.sourceReportId,
    sourceReportDigestHex: source.contentDigestHex, knowledgeAtUtc: source.knowledgeAtUtc,
    kind: "SOURCE_QUARANTINE", truthRecordId: null, admissionEventId: quarantine.realityEventId });
  const aliases = ledger.truths.filter((t) => isRealitySemanticDuplicateV2(source, t))
    .sort((a, b) => a.truthRecordId.localeCompare(b.truthRecordId));
  for (const truth of aliases) {
    const event = admission(truth);
    if (event) return Object.freeze({ sourceReportId: source.sourceReportId,
      sourceReportDigestHex: source.contentDigestHex, knowledgeAtUtc: source.knowledgeAtUtc,
      kind: "SEMANTIC_ALIAS", truthRecordId: truth.truthRecordId, admissionEventId: event.realityEventId });
  }
  refuseDelivery("DELIVERY_INCOMPLETE");
}
export function findDeliverySource(scope: RealityAccountContext, draft: AppendRealitySourceReportV2Input,
  sources: readonly RealitySourceReportV2[]): RealitySourceReportV2 | null {
  const matches = sources.filter((s) => equal(s.lineage, draft.lineage));
  for (const source of matches) {
    const expected = createRealitySourceReportV2({ ...draft, ...scope, knowledgeAtUtc: source.knowledgeAtUtc });
    if (equal(source, expected)) return source;
    if (equal(source.sourceNativeIdentity, expected.sourceNativeIdentity) && equal(source.subject, expected.subject)) {
      refuseDelivery("SOURCE_BINDING_INVALID");
    }
  }
  return null;
}
