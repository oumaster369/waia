import { canonicalizeSemanticJsonString as canonicalJsonString, computeSemanticSha256Hex as computeStableJsonDigest } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { compareDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { serializeReportingPeriodDigestInput, verifyReportingPeriodRecordDigest,
  type SerializedReportingPeriodDigestInput } from "../serialize-reporting-period";
import { REPORTING_PERIOD_SCHEMA_VERSION, type ReportingPeriodRecordPayload } from "../reporting-period.types";
import type { RealityLedgerV2 } from "@/lib/trader/reality/v2/projection";
import type { RealityProjectionV2 } from "@/lib/trader/reality/v2/contracts";
import { admitCanonicalPeriodProfitFromReceiptV2, billingPeriodReportingScopeIdV2 } from "./admit-realized-profit-receipt-v2";
import { assertBillingRealityCandidate, assertBillingRealityScope, parseBillingRealityDependencies,
  snapshotBillingCommand, type BillingRealityCandidate, type BillingRealityDependenciesMatched } from "./reality-dependencies-v1";

export const REPORTING_PERIOD_BASIS_V1 = "waia.trader.reporting_period_basis.v1" as const;
export const REPORTING_PERIOD_BASIS_MAX_BYTES = 16 * 1024 * 1024;
export const BASIS_REPLAY_MAX_IDENTITIES = 4096;
export const BASIS_REPLAY_MAX_ROW_BYTES = 1024 * 1024;
export const BASIS_REPLAY_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const BASIS_REPLAY_MAX_PROJECTION_BYTES = 16 * 1024 * 1024;

export type ReportingPeriodBasisCode = "BASIS_INVALID_INPUT" | "BASIS_TRANSACTION_OWNER_REQUIRED" |
  "BASIS_PERIOD_NOT_FOUND" | "PERIOD_NOT_CLOSED" | "BASIS_SCHEMA_UNAVAILABLE" |
  "BASIS_VERSION_UNSUPPORTED" | "BASIS_CONTENT_INVALID" | "BASIS_PERIOD_MISMATCH" |
  "BASIS_SOURCE_REPLAY_UNAVAILABLE" | "BASIS_SOURCE_REPLAY_MISMATCH" | "BASIS_CAPACITY_EXCEEDED";
export class ReportingPeriodBasisError extends Error {
  constructor(readonly code: ReportingPeriodBasisCode) { super(code); this.name = "ReportingPeriodBasisError"; }
}
export function refusePeriodBasis(code: ReportingPeriodBasisCode): never { throw new ReportingPeriodBasisError(code); }

type Identity = Readonly<{ id: string; contentDigestHex: string }>;
export type ReportingPeriodBasisReadSetV1 = Readonly<{
  sources: readonly Identity[];
  truths: readonly Identity[];
  events: readonly (Identity & { sequence: string })[];
  projectionId: string;
}>;
export type ReportingPeriodBasisActorV1 = Readonly<{ type: "USER"; userId: string }> | Readonly<{ type: "SERVICE" }>;
export type ReportingPeriodBasisV1 = Readonly<{
  schemaVersion: typeof REPORTING_PERIOD_BASIS_V1;
  capitalAuthority: "NONE";
  organizationId: string;
  exchangeAccountId: string;
  reportingPeriodId: string;
  period: SerializedReportingPeriodDigestInput & { recordContentDigest: string };
  receipt: BillingRealityCandidate["realizedStrategyProfitReceipt"];
  settlements: BillingRealityCandidate["closedTradeSettlements"];
  dependencies: BillingRealityDependenciesMatched;
  ledgerReadSet: ReportingPeriodBasisReadSetV1;
  actor: ReportingPeriodBasisActorV1;
  contentDigestHex: string;
}>;
const isDigest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    canonicalJsonString(Object.keys(value).sort()) !== canonicalJsonString([...keys].sort())) refusePeriodBasis("BASIS_CONTENT_INVALID");
}
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function captureReportingPeriodBasisReadSet(ledger: RealityLedgerV2, projection: RealityProjectionV2): ReportingPeriodBasisReadSetV1 {
  const sources = ledger.sources.map((s) => ({ id: s.sourceReportId, contentDigestHex: s.contentDigestHex })).sort((a, b) => lexical(a.id, b.id));
  const truths = ledger.truths.map((t) => ({ id: t.truthRecordId, contentDigestHex: t.contentDigestHex })).sort((a, b) => lexical(a.id, b.id));
  const events = ledger.events.map((e) => ({ id: e.realityEventId, contentDigestHex: e.contentDigestHex, sequence: e.eventSequence }))
    .sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0);
  const manifest = snapshotBillingCommand({ sources, truths, events, projectionId: projection.projectionId });
  assertReportingPeriodBasisReadSet(manifest, projection);
  const sourceIds = new Set(sources.map((r) => r.id)), truthIds = new Set(truths.map((r) => r.id)), eventIds = new Set(events.map((r) => r.id));
  if (ledger.truths.some((t) => !sourceIds.has(t.sourceReportId) || (t.supersedesTruthRecordId && !truthIds.has(t.supersedesTruthRecordId))) ||
    ledger.events.some((e) => !sourceIds.has(e.sourceReportId) || (e.truthRecordId && !truthIds.has(e.truthRecordId)) ||
      (e.relatedTruthRecordId && !truthIds.has(e.relatedTruthRecordId)) || (e.quarantineEventId && !eventIds.has(e.quarantineEventId)))) {
    refusePeriodBasis("BASIS_SOURCE_REPLAY_MISMATCH");
  }
  return manifest;
}

export function assertReportingPeriodBasisReadSet(value: unknown, projection: { projectionId: string; frontierSequence: string; frontierEventDigestHex: string | null }): asserts value is ReportingPeriodBasisReadSetV1 {
  exact(value, ["sources", "truths", "events", "projectionId"]);
  if (!isDigest(value.projectionId) || value.projectionId !== projection.projectionId) refusePeriodBasis("BASIS_CONTENT_INVALID");
  for (const key of ["sources", "truths", "events"] as const) {
    const rows = value[key];
    if (!Array.isArray(rows)) refusePeriodBasis("BASIS_CONTENT_INVALID");
    const seen = new Set<string>();
    let prior = "";
    rows.forEach((row, index) => {
      exact(row, key === "events" ? ["id", "contentDigestHex", "sequence"] : ["id", "contentDigestHex"]);
      if (!isDigest(row.id) || !isDigest(row.contentDigestHex) || seen.has(row.id)) refusePeriodBasis("BASIS_CONTENT_INVALID");
      seen.add(row.id);
      if (key === "events") {
        if (row.sequence !== String(index + 1)) refusePeriodBasis("BASIS_CONTENT_INVALID");
      } else if (index > 0 && lexical(prior, row.id) >= 0) refusePeriodBasis("BASIS_CONTENT_INVALID");
      prior = row.id;
    });
  }
  const events = value.events as ReportingPeriodBasisReadSetV1["events"];
  if (!events.length || events.at(-1)!.sequence !== projection.frontierSequence ||
    events.at(-1)!.contentDigestHex !== projection.frontierEventDigestHex) refusePeriodBasis("BASIS_CONTENT_INVALID");
}

export function periodFromBasis(value: unknown): ReportingPeriodRecordPayload {
  exact(value, ["schemaVersion", "organizationId", "exchangeAccountId", "periodStart", "periodEnd", "startingEquity", "endingEquity",
    "openPositionsSnapshotRef", "realizedPnl", "unrealizedPnl", "netDeposits", "netWithdrawals", "valuationSource", "startingSnapshotAt", "endingSnapshotAt", "status", "recordContentDigest"]);
  if (value.schemaVersion !== REPORTING_PERIOD_SCHEMA_VERSION || value.status !== "CLOSED" || !isDigest(value.recordContentDigest)) refusePeriodBasis("BASIS_CONTENT_INVALID");
  for (const key of ["organizationId", "exchangeAccountId", "openPositionsSnapshotRef", "valuationSource"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) refusePeriodBasis("BASIS_CONTENT_INVALID");
  }
  for (const key of ["startingEquity", "endingEquity", "realizedPnl", "unrealizedPnl", "netDeposits", "netWithdrawals"] as const) {
    if (typeof value[key] !== "string" || !/[0-9]/.test(value[key])) refusePeriodBasis("BASIS_CONTENT_INVALID");
    parseDecimal(value[key]);
  }
  const date = (key: string) => {
    const raw = value[key];
    if (typeof raw !== "string" || new Date(raw).toISOString() !== raw) refusePeriodBasis("BASIS_CONTENT_INVALID");
    return new Date(raw);
  };
  const row = { ...value, periodStart: date("periodStart"), periodEnd: date("periodEnd"), startingSnapshotAt: date("startingSnapshotAt"),
    endingSnapshotAt: date("endingSnapshotAt") } as ReportingPeriodRecordPayload;
  verifyReportingPeriodRecordDigest(row);
  return row;
}

function validateBody(value: unknown): asserts value is Omit<ReportingPeriodBasisV1, "contentDigestHex"> {
  exact(value, ["schemaVersion", "capitalAuthority", "organizationId", "exchangeAccountId", "reportingPeriodId", "period", "receipt", "settlements", "dependencies", "ledgerReadSet", "actor"]);
  if (value.schemaVersion !== REPORTING_PERIOD_BASIS_V1) refusePeriodBasis("BASIS_VERSION_UNSUPPORTED");
  if (value.capitalAuthority !== "NONE" || !isUuid(value.reportingPeriodId)) refusePeriodBasis("BASIS_CONTENT_INVALID");
  assertBillingRealityScope(value.organizationId as string, value.exchangeAccountId as string);
  const period = periodFromBasis(value.period);
  if (period.organizationId !== value.organizationId || period.exchangeAccountId !== value.exchangeAccountId) refusePeriodBasis("BASIS_PERIOD_MISMATCH");
  exact(value.dependencies, ["dependenciesMatched", "binding", "economicAttribution", "periodCompleteness", "priorConsumption", "realizedFillFinality"]);
  const proof = value.dependencies;
  if (proof.dependenciesMatched !== true || proof.economicAttribution !== "UNPROVEN" || proof.periodCompleteness !== "UNPROVEN" ||
    proof.priorConsumption !== "UNPROVEN" || proof.realizedFillFinality !== "OPERATOR_VERIFICATION_REQUIRED") refusePeriodBasis("BASIS_CONTENT_INVALID");
  const binding = parseBillingRealityDependencies(proof.binding);
  assertReportingPeriodBasisReadSet(value.ledgerReadSet, binding.projection);
  const candidate = { exchangeAccountId: value.exchangeAccountId, realizedStrategyProfitReceipt: value.receipt,
    closedTradeSettlements: value.settlements, realityDependencies: binding } as BillingRealityCandidate;
  assertBillingRealityCandidate(value.organizationId as string, candidate);
  const settlements = candidate.closedTradeSettlements;
  if (new Set(settlements.map((s) => s.contentDigestHex)).size !== settlements.length ||
    settlements.some((s, i) => i > 0 && lexical(settlements[i - 1].contentDigestHex, s.contentDigestHex) >= 0)) refusePeriodBasis("BASIS_CONTENT_INVALID");
  const profit = admitCanonicalPeriodProfitFromReceiptV2({ organizationId: period.organizationId, accountId: period.exchangeAccountId,
    receipt: candidate.realizedStrategyProfitReceipt, settlements,
    expectedReportingScopeId: billingPeriodReportingScopeIdV2({ organizationId: period.organizationId, accountId: period.exchangeAccountId,
      periodStart: period.periodStart, periodEnd: period.periodEnd! }) });
  if (compareDecimal(period.realizedPnl!, profit) !== 0) refusePeriodBasis("BASIS_PERIOD_MISMATCH");
  const actor = value.actor as Record<string, unknown> | null;
  if (actor?.type === "USER") {
    exact(actor, ["type", "userId"]);
    if (typeof actor.userId !== "string" || !actor.userId.trim()) refusePeriodBasis("BASIS_CONTENT_INVALID");
  } else if (actor?.type === "SERVICE") exact(actor, ["type"]);
  else refusePeriodBasis("BASIS_CONTENT_INVALID");
}

export function buildReportingPeriodBasisV1(input: {
  period: ReportingPeriodRecordPayload & { id: string }; candidate: BillingRealityCandidate;
  dependencies: BillingRealityDependenciesMatched; ledgerReadSet: ReportingPeriodBasisReadSetV1; actor: ReportingPeriodBasisActorV1;
}): ReportingPeriodBasisV1 {
  try {
    const body = { schemaVersion: REPORTING_PERIOD_BASIS_V1, capitalAuthority: "NONE" as const,
      organizationId: input.period.organizationId, exchangeAccountId: input.period.exchangeAccountId, reportingPeriodId: input.period.id,
      period: { ...serializeReportingPeriodDigestInput(input.period), recordContentDigest: input.period.recordContentDigest },
      receipt: input.candidate.realizedStrategyProfitReceipt, settlements: [...input.candidate.closedTradeSettlements].sort((a, b) => lexical(a.contentDigestHex, b.contentDigestHex)),
      dependencies: input.dependencies, ledgerReadSet: input.ledgerReadSet, actor: input.actor };
    validateBody(body);
    const basis = snapshotBillingCommand({ ...body, contentDigestHex: computeStableJsonDigest(body) });
    assertReportingPeriodBasisCapacity(canonicalJsonString(basis));
    return basis;
  } catch (error) { if (error instanceof ReportingPeriodBasisError) throw error; refusePeriodBasis("BASIS_CONTENT_INVALID"); }
}

export function assertReportingPeriodBasisCapacity(canonicalText: string): void {
  if (Buffer.byteLength(canonicalText, "utf8") > REPORTING_PERIOD_BASIS_MAX_BYTES) refusePeriodBasis("BASIS_CAPACITY_EXCEEDED");
}
export function parseReportingPeriodBasisV1(canonicalText: string): ReportingPeriodBasisV1 {
  assertReportingPeriodBasisCapacity(canonicalText);
  try {
    const parsed = JSON.parse(canonicalText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) refusePeriodBasis("BASIS_CONTENT_INVALID");
    const { contentDigestHex, ...body } = parsed;
    validateBody(body);
    if (!isDigest(contentDigestHex) || computeStableJsonDigest(body) !== contentDigestHex || canonicalJsonString(parsed) !== canonicalText) refusePeriodBasis("BASIS_CONTENT_INVALID");
    return snapshotBillingCommand(parsed);
  } catch (error) { if (error instanceof ReportingPeriodBasisError) throw error; refusePeriodBasis("BASIS_CONTENT_INVALID"); }
}

export function candidateFromReportingPeriodBasis(basis: ReportingPeriodBasisV1): BillingRealityCandidate {
  return { exchangeAccountId: basis.exchangeAccountId, realizedStrategyProfitReceipt: basis.receipt,
    closedTradeSettlements: basis.settlements, realityDependencies: basis.dependencies.binding };
}
