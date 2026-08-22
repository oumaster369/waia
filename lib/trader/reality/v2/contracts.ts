import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  EXECUTION_REPORT_TYPES_V2,
  type ExecutionReportTypeV2,
} from "@/lib/trader/execution/v2/contracts";

export const REALITY_SOURCE_REPORT_V2_SCHEMA_VERSION = "reality-source-report/v2" as const;
export const TRUTH_RECORD_V2_SCHEMA_VERSION = "truth-record/v2" as const;
export const REALITY_EVENT_V2_SCHEMA_VERSION = "reality-event/v2" as const;
export const REALITY_PROJECTION_V2_SCHEMA_VERSION = "reality-projection/v2" as const;
export const REALITY_PROJECTION_POLICY_V2 = "reality-fold/htx-spot-v1" as const;

export const REALITY_SOURCE_KINDS_V2 = [
  "EXECUTION_REPORT_V2",
  "HTX_SPOT_ORDER_REST",
  "HTX_SPOT_FILL_REST",
  "HTX_SPOT_BALANCE_REST",
  "HTX_SPOT_ACCOUNT_REST",
] as const;

export const REALITY_SUBJECT_CLASSES_V2 = [
  "ORDER",
  "VENUE_EVENT",
  "FILL",
  "BALANCE",
  "ACCOUNT",
  "POSITION_INVENTORY",
  "REALIZED_CASHFLOW",
] as const;

export const REALITY_EVENT_TYPES_V2 = [
  "OBSERVED",
  "QUARANTINED",
  "RELEASED",
  "SUPERSEDED",
  "SOURCE_CONTRADICTION",
] as const;

export const REALITY_MARKERS_V2 = ["SOURCE_CONTRADICTION", "UNATTRIBUTED"] as const;

export type RealitySourceKindV2 = (typeof REALITY_SOURCE_KINDS_V2)[number];
export type RealitySubjectClassV2 = (typeof REALITY_SUBJECT_CLASSES_V2)[number];
export type RealityEventTypeV2 = (typeof REALITY_EVENT_TYPES_V2)[number];
export type RealityMarkerV2 = (typeof REALITY_MARKERS_V2)[number];

export type RealitySubjectIdentityV2 = Readonly<{
  subjectClass: RealitySubjectClassV2;
  subjectKey: string;
}>;

export type RealitySourceNativeIdentityV2 = Readonly<{
  identityKind:
    | "EXECUTION_REPORT_ID"
    | "HTX_ORDER_ID"
    | "HTX_TRADE_ID"
    | "HTX_BALANCE_SNAPSHOT_ID"
    | "HTX_ACCOUNT_SNAPSHOT_ID";
  nativeId: string;
  nativeRevision: string | null;
  supersedesNativeRevision: string | null;
}>;

export type RealityExecutionReportLineageV2 = Readonly<{
  lineageKind: "EXECUTION_REPORT_V2";
  executionReportId: string;
  executionReportDigestHex: string;
}>;

export type RealityRawCaptureLineageV2 = Readonly<{
  lineageKind: "RAW_CAPTURE_V1";
  rawCaptureReceiptDigestHex: string;
  rawBytesDigestHex: string;
  storageBindingDigestHex: string;
}>;

export type RealitySourceLineageV2 =
  | RealityExecutionReportLineageV2
  | RealityRawCaptureLineageV2;

export type RealityExecutionSourceMetadataV2 = readonly [
  Readonly<{ key: "reportSequence"; value: string }>,
  Readonly<{ key: "reportType"; value: ExecutionReportTypeV2 }>,
];

type RealitySourceProvenanceBaseV2 = Readonly<{
  venue: "HTX";
  connectorId: string;
  connectorVersion: string;
  adapterVersion: string;
}>;

export type RealitySourceProvenanceV2 = RealitySourceProvenanceBaseV2 & (
  | Readonly<{
      transport: "INTERNAL_APPEND_ONLY";
      sourceFinalityMetadata: RealityExecutionSourceMetadataV2;
    }>
  | Readonly<{
      transport: "REST";
      sourceFinalityMetadata: readonly [];
    }>
);

export type RealityPrimitiveAssertionV2 =
  | Readonly<{
      kind: "ORDER";
      venueOrderId: string;
      clientOrderId: string | null;
      symbol: string;
      side: "buy" | "sell";
      orderType: "market" | "limit";
      status: string;
      quantity: string | null;
      limitPrice: string | null;
    }>
  | Readonly<{
      kind: "VENUE_EVENT";
      eventType: string;
      venueOrderId: string | null;
      status: string | null;
    }>
  | Readonly<{
      kind: "FILL";
      venueTradeId: string;
      venueOrderId: string;
      symbol: string;
      side: "buy" | "sell";
      quantity: string;
      price: string;
      feeAmount: string;
      feeAsset: string;
      settlementStatus: "OBSERVED" | "SETTLED";
    }>
  | Readonly<{
      kind: "BALANCE";
      asset: string;
      available: string;
      locked: string;
      total: string;
    }>
  | Readonly<{
      kind: "ACCOUNT";
      venueAccountId: string;
      accountType: "SPOT";
      accountState: string;
      permissions: readonly string[];
    }>
  | Readonly<{
      kind: "POSITION_INVENTORY";
      asset: string;
      symbol: string;
      quantity: string;
    }>
  | Readonly<{
      kind: "REALIZED_CASHFLOW";
      cashflowId: string;
      asset: string;
      amount: string;
      direction: "INFLOW" | "OUTFLOW";
      causeNativeId: string;
    }>;

export type RealitySourceReportV2 = Readonly<{
  schemaVersion: typeof REALITY_SOURCE_REPORT_V2_SCHEMA_VERSION;
  sourceReportId: string;
  organizationId: string;
  accountId: string;
  sourceKind: RealitySourceKindV2;
  sourceNativeIdentity: RealitySourceNativeIdentityV2 | null;
  attributionStatus: "ATTRIBUTED" | "UNATTRIBUTED";
  subject: RealitySubjectIdentityV2;
  primitiveAssertion: RealityPrimitiveAssertionV2 | null;
  lineage: RealitySourceLineageV2;
  provenance: RealitySourceProvenanceV2;
  structuralVerification: "VERIFIED" | "UNVERIFIABLE";
  verificationReasonCodes: readonly string[];
  validAtUtc: string;
  knowledgeAtUtc: string;
  contentDigestHex: string;
}>;

export type RealitySourceReportV2Draft = Omit<
  RealitySourceReportV2,
  "schemaVersion" | "sourceReportId" | "contentDigestHex"
>;

export type TruthRecordV2 = Readonly<{
  schemaVersion: typeof TRUTH_RECORD_V2_SCHEMA_VERSION;
  truthRecordId: string;
  organizationId: string;
  accountId: string;
  sourceReportId: string;
  sourceReportDigestHex: string;
  sourceKind: RealitySourceKindV2;
  sourceNativeIdentity: RealitySourceNativeIdentityV2 | null;
  subject: RealitySubjectIdentityV2;
  primitiveAssertion: RealityPrimitiveAssertionV2;
  validAtUtc: string;
  knowledgeAtUtc: string;
  supersedesTruthRecordId: string | null;
  markers: readonly RealityMarkerV2[];
  contentDigestHex: string;
}>;

export type TruthRecordV2Draft = Omit<
  TruthRecordV2,
  "schemaVersion" | "truthRecordId" | "contentDigestHex"
>;

export type RealityEventV2 = Readonly<{
  schemaVersion: typeof REALITY_EVENT_V2_SCHEMA_VERSION;
  realityEventId: string;
  organizationId: string;
  accountId: string;
  eventSequence: string;
  eventType: RealityEventTypeV2;
  sourceReportId: string;
  truthRecordId: string | null;
  relatedTruthRecordId: string | null;
  reasonCodes: readonly string[];
  knowledgeAtUtc: string;
  previousEventDigestHex: string | null;
  contentDigestHex: string;
}>;

export type RealityEventV2Draft = Omit<
  RealityEventV2,
  "schemaVersion" | "realityEventId" | "contentDigestHex"
>;

export type RealityProjectionEntryV2 = Readonly<{
  subject: RealitySubjectIdentityV2;
  truthRecordId: string;
  sourceReportId: string;
  validAtUtc: string;
  knowledgeAtUtc: string;
  primitiveAssertion: RealityPrimitiveAssertionV2;
}>;

export type RealityProjectionUncertaintyV2 = Readonly<{
  sourceReportId: string;
  subject: RealitySubjectIdentityV2;
  marker: RealityMarkerV2;
  reasonCodes: readonly string[];
}>;

export type RealityProjectionV2 = Readonly<{
  schemaVersion: typeof REALITY_PROJECTION_V2_SCHEMA_VERSION;
  projectionId: string;
  organizationId: string;
  accountId: string;
  projectionPolicyVersion: typeof REALITY_PROJECTION_POLICY_V2;
  knowledgeAsOfUtc: string;
  frontierSequence: string;
  frontierEventDigestHex: string | null;
  stableEntries: readonly RealityProjectionEntryV2[];
  uncertainties: readonly RealityProjectionUncertaintyV2[];
  contentDigestHex: string;
}>;

export type RealityProjectionV2Draft = Omit<
  RealityProjectionV2,
  "schemaVersion" | "projectionId" | "projectionPolicyVersion" | "contentDigestHex"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SAFE_KEY = /^[A-Za-z0-9._:/=-]{1,256}$/;
const SAFE_PROVENANCE_COMPONENT = /^[A-Za-z0-9._:/=-]{1,128}$/;
const SECRET_KEY = /(?:access[-_]?key|api[-_]?key|authorization|cookie|credential|password|secret|signature|token)/i;
const EXECUTION_SEQUENCE = /^[1-9][0-9]{0,18}$/;
const MAX_POSTGRES_BIGINT = "9223372036854775807";

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value;
}

function requireUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new Error(`${field} must be a canonical UUID`);
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!DIGEST.test(value)) throw new Error(`${field} must be lowercase sha256 hex`);
  return value;
}

function requireTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC milliseconds`);
  }
  return value;
}

function requireSequence(value: string, field: string, allowZero = false): string {
  const expression = allowZero ? /^(?:0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
  if (!expression.test(value)) throw new Error(`${field} must be a canonical integer string`);
  return value;
}

function requireDecimal(value: string, field: string, nonnegative = false): string {
  const parsed = parseDecimal(value);
  if (formatDecimal(parsed) !== value || (nonnegative && parsed < 0n)) {
    throw new Error(`${field} must be a canonical${nonnegative ? " nonnegative" : ""} decimal`);
  }
  return value;
}

function exactKeys(value: object, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${field} has unexpected fields`);
  }
}

function canonicalReasons(values: readonly string[], field: string): readonly string[] {
  const sorted = [...values].sort();
  if (sorted.some((value) => !REASON_CODE.test(value)) || new Set(sorted).size !== sorted.length ||
    sorted.some((value, index) => value !== values[index])) {
    throw new Error(`${field} must be sorted unique reason codes`);
  }
  return Object.freeze(sorted);
}

function canonicalMarkers(values: readonly RealityMarkerV2[]): readonly RealityMarkerV2[] {
  const sorted = [...values].sort();
  if (sorted.some((value) => !REALITY_MARKERS_V2.includes(value)) ||
    new Set(sorted).size !== sorted.length || sorted.some((value, index) => value !== values[index])) {
    throw new Error("markers must be sorted unique Reality-owned markers");
  }
  return Object.freeze(sorted);
}

function canonicalSubject(value: RealitySubjectIdentityV2): RealitySubjectIdentityV2 {
  exactKeys(value, ["subjectClass", "subjectKey"], "subject");
  if (!REALITY_SUBJECT_CLASSES_V2.includes(value.subjectClass) ||
    !SAFE_KEY.test(value.subjectKey) || SECRET_KEY.test(value.subjectKey)) {
    throw new Error("invalid Reality subject identity");
  }
  return Object.freeze({ ...value });
}

function canonicalNativeIdentity(
  value: RealitySourceNativeIdentityV2 | null,
): RealitySourceNativeIdentityV2 | null {
  if (value === null) return null;
  exactKeys(
    value,
    ["identityKind", "nativeId", "nativeRevision", "supersedesNativeRevision"],
    "sourceNativeIdentity",
  );
  requireText(value.nativeId, "nativeId");
  if (SECRET_KEY.test(value.nativeId)) throw new Error("nativeId appears secret-bearing");
  if (value.supersedesNativeRevision !== null &&
    (value.nativeRevision === null || value.nativeRevision === value.supersedesNativeRevision)) {
    throw new Error("source-native correction requires distinct current and superseded revisions");
  }
  if (value.nativeRevision !== null) requireText(value.nativeRevision, "nativeRevision");
  if (value.supersedesNativeRevision !== null) {
    requireText(value.supersedesNativeRevision, "supersedesNativeRevision");
  }
  return Object.freeze({ ...value });
}

function canonicalLineage(value: RealitySourceLineageV2): RealitySourceLineageV2 {
  if (value.lineageKind === "EXECUTION_REPORT_V2") {
    exactKeys(value, ["lineageKind", "executionReportId", "executionReportDigestHex"], "lineage");
    return Object.freeze({
      lineageKind: value.lineageKind,
      executionReportId: requireUuid(value.executionReportId, "executionReportId"),
      executionReportDigestHex: requireDigest(value.executionReportDigestHex, "executionReportDigestHex"),
    });
  }
  exactKeys(
    value,
    ["lineageKind", "rawCaptureReceiptDigestHex", "rawBytesDigestHex", "storageBindingDigestHex"],
    "lineage",
  );
  return Object.freeze({
    lineageKind: value.lineageKind,
    rawCaptureReceiptDigestHex: requireDigest(value.rawCaptureReceiptDigestHex, "rawCaptureReceiptDigestHex"),
    rawBytesDigestHex: requireDigest(value.rawBytesDigestHex, "rawBytesDigestHex"),
    storageBindingDigestHex: requireDigest(value.storageBindingDigestHex, "storageBindingDigestHex"),
  });
}

function canonicalProvenance(value: RealitySourceProvenanceV2): RealitySourceProvenanceV2 {
  exactKeys(
    value,
    ["venue", "transport", "connectorId", "connectorVersion", "adapterVersion", "sourceFinalityMetadata"],
    "provenance",
  );
  if (value.venue !== "HTX") throw new Error("Reality V2 MVP venue must be HTX");
  for (const [field, component] of [
    ["connectorId", value.connectorId],
    ["connectorVersion", value.connectorVersion],
    ["adapterVersion", value.adapterVersion],
  ] as const) {
    if (!SAFE_PROVENANCE_COMPONENT.test(component) || SECRET_KEY.test(component)) {
      throw new Error(`${field} must be a bounded non-secret provenance identifier`);
    }
  }
  if (value.transport === "REST") {
    if (value.sourceFinalityMetadata.length !== 0) {
      throw new Error("REST Reality provenance metadata must be empty");
    }
    return Object.freeze({ ...value, sourceFinalityMetadata: Object.freeze([] as const) });
  }
  if (value.transport !== "INTERNAL_APPEND_ONLY" || value.sourceFinalityMetadata.length !== 2) {
    throw new Error("Execution Reality provenance requires exact typed metadata");
  }
  const [sequence, reportType] = value.sourceFinalityMetadata;
  exactKeys(sequence, ["key", "value"], "reportSequence metadata");
  exactKeys(reportType, ["key", "value"], "reportType metadata");
  if (sequence.key !== "reportSequence" || typeof sequence.value !== "string" ||
    !EXECUTION_SEQUENCE.test(sequence.value) ||
    (sequence.value.length === MAX_POSTGRES_BIGINT.length &&
      sequence.value.localeCompare(MAX_POSTGRES_BIGINT) > 0) ||
    reportType.key !== "reportType" || typeof reportType.value !== "string" ||
    !EXECUTION_REPORT_TYPES_V2.includes(reportType.value as ExecutionReportTypeV2)) {
    throw new Error("Execution Reality provenance metadata is outside its canonical domain");
  }
  return Object.freeze({
    ...value,
    sourceFinalityMetadata: Object.freeze([
      Object.freeze({ key: "reportSequence" as const, value: sequence.value }),
      Object.freeze({ key: "reportType" as const, value: reportType.value as ExecutionReportTypeV2 }),
    ]) as RealityExecutionSourceMetadataV2,
  });
}

function canonicalAssertion(value: RealityPrimitiveAssertionV2): RealityPrimitiveAssertionV2 {
  switch (value.kind) {
    case "ORDER":
      exactKeys(value, ["kind", "venueOrderId", "clientOrderId", "symbol", "side", "orderType", "status", "quantity", "limitPrice"], "ORDER assertion");
      requireText(value.venueOrderId, "venueOrderId");
      requireText(value.symbol, "symbol");
      requireText(value.status, "status");
      if (value.clientOrderId !== null) requireText(value.clientOrderId, "clientOrderId");
      if (value.quantity !== null) requireDecimal(value.quantity, "quantity", true);
      if (value.limitPrice !== null) requireDecimal(value.limitPrice, "limitPrice", true);
      if (value.orderType === "market" && value.limitPrice !== null) {
        throw new Error("market order assertion cannot carry a limit price");
      }
      return Object.freeze({ ...value });
    case "VENUE_EVENT":
      exactKeys(value, ["kind", "eventType", "venueOrderId", "status"], "VENUE_EVENT assertion");
      requireText(value.eventType, "eventType");
      if (value.venueOrderId !== null) requireText(value.venueOrderId, "venueOrderId");
      if (value.status !== null) requireText(value.status, "status");
      return Object.freeze({ ...value });
    case "FILL":
      exactKeys(value, ["kind", "venueTradeId", "venueOrderId", "symbol", "side", "quantity", "price", "feeAmount", "feeAsset", "settlementStatus"], "FILL assertion");
      requireText(value.venueTradeId, "venueTradeId");
      requireText(value.venueOrderId, "venueOrderId");
      requireText(value.symbol, "symbol");
      requireText(value.feeAsset, "feeAsset");
      requireDecimal(value.quantity, "quantity", true);
      if (parseDecimal(value.quantity) <= 0n) throw new Error("fill quantity must be positive");
      requireDecimal(value.price, "price", true);
      if (parseDecimal(value.price) <= 0n) throw new Error("fill price must be positive");
      requireDecimal(value.feeAmount, "feeAmount", true);
      return Object.freeze({ ...value });
    case "BALANCE": {
      exactKeys(value, ["kind", "asset", "available", "locked", "total"], "BALANCE assertion");
      requireText(value.asset, "asset");
      const available = parseDecimal(requireDecimal(value.available, "available", true));
      const locked = parseDecimal(requireDecimal(value.locked, "locked", true));
      const total = parseDecimal(requireDecimal(value.total, "total", true));
      if (available + locked !== total) throw new Error("balance total must equal available plus locked");
      return Object.freeze({ ...value });
    }
    case "ACCOUNT": {
      exactKeys(value, ["kind", "venueAccountId", "accountType", "accountState", "permissions"], "ACCOUNT assertion");
      requireText(value.venueAccountId, "venueAccountId");
      requireText(value.accountState, "accountState");
      const permissions = [...value.permissions].sort();
      if (permissions.length === 0 || permissions.some((entry) => entry.trim() === "") ||
        new Set(permissions).size !== permissions.length ||
        permissions.some((entry, index) => entry !== value.permissions[index])) {
        throw new Error("account permissions must be sorted, unique, and non-empty");
      }
      return Object.freeze({ ...value, permissions: Object.freeze(permissions) });
    }
    case "POSITION_INVENTORY":
      exactKeys(value, ["kind", "asset", "symbol", "quantity"], "POSITION_INVENTORY assertion");
      requireText(value.asset, "asset");
      requireText(value.symbol, "symbol");
      requireDecimal(value.quantity, "quantity", true);
      return Object.freeze({ ...value });
    case "REALIZED_CASHFLOW":
      exactKeys(value, ["kind", "cashflowId", "asset", "amount", "direction", "causeNativeId"], "REALIZED_CASHFLOW assertion");
      requireText(value.cashflowId, "cashflowId");
      requireText(value.asset, "asset");
      requireText(value.causeNativeId, "causeNativeId");
      requireDecimal(value.amount, "amount", true);
      if (parseDecimal(value.amount) <= 0n) throw new Error("cashflow amount must be positive");
      return Object.freeze({ ...value });
  }
}

export function createRealitySourceReportV2(
  draft: RealitySourceReportV2Draft,
): RealitySourceReportV2 {
  requireUuid(draft.organizationId, "organizationId");
  requireText(draft.accountId, "accountId");
  if (!REALITY_SOURCE_KINDS_V2.includes(draft.sourceKind)) throw new Error("source kind is not admitted");
  const sourceNativeIdentity = canonicalNativeIdentity(draft.sourceNativeIdentity);
  if ((sourceNativeIdentity === null) !== (draft.attributionStatus === "UNATTRIBUTED")) {
    throw new Error("attribution status must match source-native identity presence");
  }
  const primitiveAssertion = draft.primitiveAssertion === null
    ? null
    : canonicalAssertion(draft.primitiveAssertion);
  const reasons = canonicalReasons(draft.verificationReasonCodes, "verificationReasonCodes");
  if ((draft.structuralVerification === "VERIFIED") !== (primitiveAssertion !== null) ||
    (draft.structuralVerification === "VERIFIED") !== (reasons.length === 0)) {
    throw new Error("structural verification, assertion, and reasons are inconsistent");
  }
  const payload = {
    ...draft,
    schemaVersion: REALITY_SOURCE_REPORT_V2_SCHEMA_VERSION,
    sourceNativeIdentity,
    subject: canonicalSubject(draft.subject),
    primitiveAssertion,
    lineage: canonicalLineage(draft.lineage),
    provenance: canonicalProvenance(draft.provenance),
    verificationReasonCodes: reasons,
    validAtUtc: requireTimestamp(draft.validAtUtc, "validAtUtc"),
    knowledgeAtUtc: requireTimestamp(draft.knowledgeAtUtc, "knowledgeAtUtc"),
  };
  if ((draft.sourceKind === "EXECUTION_REPORT_V2") !==
    (payload.provenance.transport === "INTERNAL_APPEND_ONLY")) {
    throw new Error("Reality source kind and transport metadata boundary disagree");
  }
  if (new Date(payload.knowledgeAtUtc).getTime() < new Date(payload.validAtUtc).getTime()) {
    throw new Error("knowledge time cannot precede source-asserted valid time");
  }
  const contentDigestHex = computeStableJsonDigest(payload);
  return Object.freeze({ ...payload, sourceReportId: contentDigestHex, contentDigestHex });
}

export function createTruthRecordV2(draft: TruthRecordV2Draft): TruthRecordV2 {
  requireUuid(draft.organizationId, "organizationId");
  requireText(draft.accountId, "accountId");
  requireDigest(draft.sourceReportId, "sourceReportId");
  requireDigest(draft.sourceReportDigestHex, "sourceReportDigestHex");
  if (draft.sourceReportId !== draft.sourceReportDigestHex) {
    throw new Error("source report identity must equal its content digest");
  }
  if (draft.supersedesTruthRecordId !== null) {
    requireDigest(draft.supersedesTruthRecordId, "supersedesTruthRecordId");
  }
  const payload = {
    ...draft,
    schemaVersion: TRUTH_RECORD_V2_SCHEMA_VERSION,
    sourceNativeIdentity: canonicalNativeIdentity(draft.sourceNativeIdentity),
    subject: canonicalSubject(draft.subject),
    primitiveAssertion: canonicalAssertion(draft.primitiveAssertion),
    validAtUtc: requireTimestamp(draft.validAtUtc, "validAtUtc"),
    knowledgeAtUtc: requireTimestamp(draft.knowledgeAtUtc, "knowledgeAtUtc"),
    markers: canonicalMarkers(draft.markers),
  };
  const contentDigestHex = computeStableJsonDigest(payload);
  return Object.freeze({ ...payload, truthRecordId: contentDigestHex, contentDigestHex });
}

export function createRealityEventV2(draft: RealityEventV2Draft): RealityEventV2 {
  requireUuid(draft.organizationId, "organizationId");
  requireText(draft.accountId, "accountId");
  requireSequence(draft.eventSequence, "eventSequence");
  if (!REALITY_EVENT_TYPES_V2.includes(draft.eventType)) throw new Error("invalid Reality event type");
  requireDigest(draft.sourceReportId, "sourceReportId");
  if (draft.truthRecordId !== null) requireDigest(draft.truthRecordId, "truthRecordId");
  if (draft.relatedTruthRecordId !== null) {
    requireDigest(draft.relatedTruthRecordId, "relatedTruthRecordId");
  }
  if ((draft.eventSequence === "1") !== (draft.previousEventDigestHex === null)) {
    throw new Error("Reality event chain head mismatch");
  }
  if (draft.previousEventDigestHex !== null) {
    requireDigest(draft.previousEventDigestHex, "previousEventDigestHex");
  }
  const payload = {
    ...draft,
    schemaVersion: REALITY_EVENT_V2_SCHEMA_VERSION,
    reasonCodes: canonicalReasons(draft.reasonCodes, "reasonCodes"),
    knowledgeAtUtc: requireTimestamp(draft.knowledgeAtUtc, "knowledgeAtUtc"),
  };
  const contentDigestHex = computeStableJsonDigest(payload);
  return Object.freeze({ ...payload, realityEventId: contentDigestHex, contentDigestHex });
}

export function createRealityProjectionV2(draft: RealityProjectionV2Draft): RealityProjectionV2 {
  requireUuid(draft.organizationId, "organizationId");
  requireText(draft.accountId, "accountId");
  requireSequence(draft.frontierSequence, "frontierSequence", true);
  if ((draft.frontierSequence === "0") !== (draft.frontierEventDigestHex === null)) {
    throw new Error("projection frontier sequence/digest mismatch");
  }
  if (draft.frontierEventDigestHex !== null) {
    requireDigest(draft.frontierEventDigestHex, "frontierEventDigestHex");
  }
  const stableEntries = draft.stableEntries.map((entry) => Object.freeze({
    ...entry,
    subject: canonicalSubject(entry.subject),
    truthRecordId: requireDigest(entry.truthRecordId, "truthRecordId"),
    sourceReportId: requireDigest(entry.sourceReportId, "sourceReportId"),
    validAtUtc: requireTimestamp(entry.validAtUtc, "validAtUtc"),
    knowledgeAtUtc: requireTimestamp(entry.knowledgeAtUtc, "knowledgeAtUtc"),
    primitiveAssertion: canonicalAssertion(entry.primitiveAssertion),
  })).sort((left, right) =>
    `${left.subject.subjectClass}:${left.subject.subjectKey}`.localeCompare(
      `${right.subject.subjectClass}:${right.subject.subjectKey}`,
    ));
  const uncertainties = draft.uncertainties.map((entry) => Object.freeze({
    ...entry,
    sourceReportId: requireDigest(entry.sourceReportId, "sourceReportId"),
    subject: canonicalSubject(entry.subject),
    reasonCodes: canonicalReasons(entry.reasonCodes, "uncertainty reasonCodes"),
  })).sort((left, right) =>
    `${left.subject.subjectClass}:${left.subject.subjectKey}:${left.sourceReportId}:${left.marker}`
      .localeCompare(
        `${right.subject.subjectClass}:${right.subject.subjectKey}:${right.sourceReportId}:${right.marker}`,
      ));
  const payload = {
    ...draft,
    schemaVersion: REALITY_PROJECTION_V2_SCHEMA_VERSION,
    projectionPolicyVersion: REALITY_PROJECTION_POLICY_V2,
    knowledgeAsOfUtc: requireTimestamp(draft.knowledgeAsOfUtc, "knowledgeAsOfUtc"),
    stableEntries: Object.freeze(stableEntries),
    uncertainties: Object.freeze(uncertainties),
  };
  const contentDigestHex = computeStableJsonDigest(payload);
  return Object.freeze({ ...payload, projectionId: contentDigestHex, contentDigestHex });
}

export function validateRealitySourceReportV2(value: RealitySourceReportV2): boolean {
  try {
    const { schemaVersion, sourceReportId, contentDigestHex, ...draft } = value;
    const rebuilt = createRealitySourceReportV2(draft);
    return schemaVersion === rebuilt.schemaVersion && sourceReportId === rebuilt.sourceReportId &&
      contentDigestHex === rebuilt.contentDigestHex;
  } catch { return false; }
}

export function validateTruthRecordV2(value: TruthRecordV2): boolean {
  try {
    const { schemaVersion, truthRecordId, contentDigestHex, ...draft } = value;
    const rebuilt = createTruthRecordV2(draft);
    return schemaVersion === rebuilt.schemaVersion && truthRecordId === rebuilt.truthRecordId &&
      contentDigestHex === rebuilt.contentDigestHex;
  } catch { return false; }
}

export function validateRealityEventV2(value: RealityEventV2): boolean {
  try {
    const { schemaVersion, realityEventId, contentDigestHex, ...draft } = value;
    const rebuilt = createRealityEventV2(draft);
    return schemaVersion === rebuilt.schemaVersion && realityEventId === rebuilt.realityEventId &&
      contentDigestHex === rebuilt.contentDigestHex;
  } catch { return false; }
}

export function validateRealityProjectionV2(value: RealityProjectionV2): boolean {
  try {
    const { schemaVersion, projectionId, projectionPolicyVersion, contentDigestHex, ...draft } = value;
    const rebuilt = createRealityProjectionV2(draft);
    return schemaVersion === rebuilt.schemaVersion && projectionId === rebuilt.projectionId &&
      projectionPolicyVersion === rebuilt.projectionPolicyVersion &&
      contentDigestHex === rebuilt.contentDigestHex;
  } catch { return false; }
}
