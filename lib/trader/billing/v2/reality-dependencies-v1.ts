import { enforceServerOnly } from "@/lib/enforce-server-only";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { compareDecimal, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { REALITY_PROJECTION_POLICY_V2, validateRealityEventV2, validateRealityProjectionV2,
  validateTruthRecordV2, type RealityProjectionV2, type TruthRecordV2 } from "@/lib/trader/reality/v2/contracts";
import { assertRealitySourceReportAdmissionV2 } from "@/lib/trader/reality/v2/source-admission";
import { foldRealityProjectionV2, type RealityLedgerV2 } from "@/lib/trader/reality/v2/projection";
import { admitCanonicalPeriodProfitFromReceiptV2, BillingCanonicalProfitAdmissionError } from "./admit-realized-profit-receipt-v2";
import type { ClosedTradeSettlementV2 } from "./closed-trade-settlement-v2";
import type { RealizedStrategyProfitReceiptV2 } from "./realized-strategy-profit-receipt-v2";

enforceServerOnly();

export const BILLING_REALITY_DEPENDENCIES_V1 = "waia.trader.billing_reality_dependencies.v1" as const;
export type BillingRealityDependenciesV1 = Readonly<{
  schemaVersion: typeof BILLING_REALITY_DEPENDENCIES_V1;
  frontierBinding: "REALITY_PROJECTION_CONTENT_DIGEST_V2";
  receiptContentDigestHex: string;
  closedTradeSettlementDigests: readonly string[];
  projection: Readonly<Pick<RealityProjectionV2, "projectionId" | "contentDigestHex" |
    "projectionPolicyVersion" | "knowledgeAsOfUtc" | "frontierSequence"> & { frontierEventDigestHex: string }>;
}>;

export type BillingRealityCandidate = {
  exchangeAccountId: string;
  realizedStrategyProfitReceipt: RealizedStrategyProfitReceiptV2;
  closedTradeSettlements: readonly ClosedTradeSettlementV2[];
  // Optional only so legacy callers receive a typed refusal, never a fallback.
  realityDependencies?: BillingRealityDependenciesV1;
};

export function refuseBillingReality(code: string): never {
  throw new BillingCanonicalProfitAdmissionError(code);
}

/** Copy nested sealed input and Dates before authorization or a lock can await.
 * This is input capture, not authentication of any copied claim. */
export function snapshotBillingCommand<T>(value: T): T {
  const visiting = new Set<object>();
  const copy = (item: unknown): unknown => {
    if (item === null || item === undefined || typeof item === "string" ||
      typeof item === "boolean" || typeof item === "number") return item;
    if (item instanceof Date) return new Date(item.getTime());
    if (typeof item !== "object" || visiting.has(item) ||
      (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) {
      refuseBillingReality("BILLING_REALITY_INVALID_INPUT");
    }
    visiting.add(item);
    const result = Array.isArray(item) ? item.map(copy) : Object.fromEntries(
      Object.entries(item).map(([key, field]) => [key, copy(field)]),
    );
    visiting.delete(item);
    return Object.freeze(result);
  };
  return copy(value) as T;
}

const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJsonString(Object.keys(value).sort()) === canonicalJsonString([...keys].sort());
}
export function assertBillingRealityOrganizationId(organizationId: string): void {
  // SQL Reality writers hash UUID::text; the TS helper hashes supplied text.
  if (typeof organizationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(organizationId)) {
    refuseBillingReality("BILLING_REALITY_SCOPE_INVALID");
  }
}
export function assertBillingRealityScope(organizationId: string, accountId: string): void {
  assertBillingRealityOrganizationId(organizationId);
  if (typeof accountId !== "string" || accountId.trim() === "") refuseBillingReality("BILLING_REALITY_SCOPE_INVALID");
}

export function parseBillingRealityDependencies(value: unknown): BillingRealityDependenciesV1 {
  if (value === undefined || value === null) refuseBillingReality("BILLING_REALITY_BINDING_REQUIRED");
  if (!exactKeys(value, ["schemaVersion", "frontierBinding", "receiptContentDigestHex", "closedTradeSettlementDigests", "projection"]) ||
    value.schemaVersion !== BILLING_REALITY_DEPENDENCIES_V1 || value.frontierBinding !== "REALITY_PROJECTION_CONTENT_DIGEST_V2") {
    refuseBillingReality("BILLING_REALITY_BINDING_UNSUPPORTED");
  }
  const p = value.projection;
  if (!exactKeys(p, ["projectionId", "contentDigestHex", "projectionPolicyVersion", "knowledgeAsOfUtc", "frontierSequence", "frontierEventDigestHex"]) ||
    !digest(value.receiptContentDigestHex) || !Array.isArray(value.closedTradeSettlementDigests) ||
    !value.closedTradeSettlementDigests.every(digest) ||
    new Set(value.closedTradeSettlementDigests).size !== value.closedTradeSettlementDigests.length ||
    !digest(p.projectionId) || p.projectionId !== p.contentDigestHex ||
    p.projectionPolicyVersion !== REALITY_PROJECTION_POLICY_V2 || !digest(p.frontierEventDigestHex) ||
    typeof p.frontierSequence !== "string" || !/^[1-9][0-9]*$/.test(p.frontierSequence) ||
    typeof p.knowledgeAsOfUtc !== "string") refuseBillingReality("BILLING_REALITY_BINDING_INVALID");
  try {
    if (new Date(p.knowledgeAsOfUtc).toISOString() !== p.knowledgeAsOfUtc) throw new Error();
  } catch { refuseBillingReality("BILLING_REALITY_BINDING_INVALID"); }
  return snapshotBillingCommand(value) as BillingRealityDependenciesV1;
}

export type BillingRealityDependenciesMatched = Readonly<{
  dependenciesMatched: true;
  binding: BillingRealityDependenciesV1;
  economicAttribution: "UNPROVEN";
  periodCompleteness: "UNPROVEN";
  priorConsumption: "UNPROVEN";
  realizedFillFinality: "OPERATOR_VERIFICATION_REQUIRED";
}>;

/** Validate immutable content before acquiring the source lock. A seal remains
 * a content check only: stored admission is still mandatory. */
export function assertBillingRealityCandidate(organizationId: string, candidate: BillingRealityCandidate): BillingRealityDependenciesV1 {
  const binding = parseBillingRealityDependencies(candidate.realityDependencies);
  try {
    const receipt = candidate.realizedStrategyProfitReceipt;
    if (!receipt || !Array.isArray(candidate.closedTradeSettlements)) refuseBillingReality("BILLING_REALITY_INVALID_INPUT");
    admitCanonicalPeriodProfitFromReceiptV2({ organizationId, accountId: candidate.exchangeAccountId,
      receipt, settlements: candidate.closedTradeSettlements, expectedReportingScopeId: receipt.reportingScopeId });
    if (receipt.contentDigestHex !== binding.receiptContentDigestHex ||
      canonicalJsonString([...binding.closedTradeSettlementDigests].sort()) !== canonicalJsonString(receipt.closedTradeSettlementDigests)) {
      refuseBillingReality("BILLING_REALITY_RECEIPT_BINDING_MISMATCH");
    }
    if (receipt.realityFrontierDigestHex !== binding.projection.contentDigestHex ||
      candidate.closedTradeSettlements.some((s) => s.realityFrontierDigestHex !== binding.projection.contentDigestHex)) {
      refuseBillingReality("BILLING_REALITY_LEGACY_FRONTIER_REFUSED");
    }
  } catch (error) {
    if (error instanceof BillingCanonicalProfitAdmissionError) throw error;
    refuseBillingReality("BILLING_REALITY_INVALID_INPUT");
  }
  return binding;
}

/** Pure consistency check used by the mandatory stored reader below. Supplied
 * ledger objects alone never authorize a production write. */
export function matchBillingRealityDependencies(input: {
  organizationId: string;
  candidate: BillingRealityCandidate;
  projection: RealityProjectionV2 | null;
  ledger: RealityLedgerV2;
}): BillingRealityDependenciesMatched {
  const { organizationId, candidate, projection, ledger } = input;
  assertBillingRealityScope(organizationId, candidate.exchangeAccountId);
  const binding = assertBillingRealityCandidate(organizationId, candidate);
  const receipt = candidate.realizedStrategyProfitReceipt;
  if (!projection || ledger.events.length === 0 || candidate.closedTradeSettlements.length === 0) {
    refuseBillingReality("BILLING_REALITY_SOURCE_UNAVAILABLE");
  }
  const head = ledger.events.at(-1)!;
  if (projection.organizationId !== organizationId || projection.accountId !== candidate.exchangeAccountId ||
    Object.entries(binding.projection).some(([key, value]) => projection[key as keyof RealityProjectionV2] !== value) ||
    head.eventSequence !== projection.frontierSequence || head.contentDigestHex !== projection.frontierEventDigestHex ||
    head.knowledgeAtUtc !== projection.knowledgeAsOfUtc) refuseBillingReality("BILLING_REALITY_FRONTIER_STALE");
  try {
    if (!validateRealityProjectionV2(projection) || !ledger.truths.every(validateTruthRecordV2) ||
      !ledger.events.every(validateRealityEventV2)) throw new Error();
    ledger.sources.forEach(assertRealitySourceReportAdmissionV2);
    const replayed = foldRealityProjectionV2({ organizationId, accountId: candidate.exchangeAccountId }, head.knowledgeAtUtc, ledger);
    if (canonicalJsonString(replayed) !== canonicalJsonString(projection)) throw new Error();
  } catch { refuseBillingReality("BILLING_REALITY_LEDGER_INVALID"); }
  const truths = new Map(ledger.truths.map((t) => [t.truthRecordId, t]));
  const sources = new Map(ledger.sources.map((s) => [s.sourceReportId, s]));
  const active = new Map(projection.stableEntries.map((e) => [e.truthRecordId, e]));
  const events = new Map(ledger.events.map((e) => [e.realityEventId, e]));
  const resolve = (id: string): TruthRecordV2 => {
    const truth = truths.get(id);
    const entry = active.get(id);
    if (!truth || !entry) refuseBillingReality("BILLING_REALITY_FACT_INACTIVE");
    const source = sources.get(truth.sourceReportId);
    if (!source || truth.organizationId !== organizationId || truth.accountId !== candidate.exchangeAccountId ||
      source.organizationId !== organizationId || source.accountId !== candidate.exchangeAccountId ||
      source.structuralVerification !== "VERIFIED" || source.attributionStatus !== "ATTRIBUTED" ||
      truth.sourceReportDigestHex !== source.contentDigestHex || truth.sourceKind !== source.sourceKind ||
      canonicalJsonString(truth.sourceNativeIdentity) !== canonicalJsonString(source.sourceNativeIdentity) ||
      canonicalJsonString(truth.subject) !== canonicalJsonString(source.subject) ||
      canonicalJsonString(truth.primitiveAssertion) !== canonicalJsonString(source.primitiveAssertion) ||
      truth.validAtUtc !== source.validAtUtc || truth.knowledgeAtUtc !== source.knowledgeAtUtc ||
      entry.sourceReportId !== source.sourceReportId || entry.validAtUtc !== truth.validAtUtc || entry.knowledgeAtUtc !== truth.knowledgeAtUtc ||
      canonicalJsonString(entry.subject) !== canonicalJsonString(truth.subject) ||
      canonicalJsonString(entry.primitiveAssertion) !== canonicalJsonString(truth.primitiveAssertion)) {
      refuseBillingReality("BILLING_REALITY_SOURCE_MISMATCH");
    }
    if (truth.markers.length > 0 || projection.uncertainties.some((u) => {
      const event = events.get(u.quarantineEventId);
      return u.sourceReportId === source.sourceReportId || canonicalJsonString(u.subject) === canonicalJsonString(truth.subject) ||
        event?.truthRecordId === id || event?.relatedTruthRecordId === id;
    })) refuseBillingReality("BILLING_REALITY_FACT_UNCERTAIN");
    return truth;
  };
  const cashflow = (id: string, amount: string) => {
    const fact = resolve(id).primitiveAssertion;
    if (fact.kind !== "REALIZED_CASHFLOW") refuseBillingReality("BILLING_REALITY_PRIMITIVE_MISMATCH");
    if (fact.asset !== "USD") refuseBillingReality("BILLING_REALITY_CONVERSION_REQUIRED");
    if (fact.direction !== "INFLOW" && fact.direction !== "OUTFLOW") refuseBillingReality("BILLING_REALITY_PRIMITIVE_MISMATCH");
    const signed = formatDecimal(fact.direction === "INFLOW" ? parseDecimal(fact.amount) : -parseDecimal(fact.amount));
    if (compareDecimal(amount, signed) !== 0) refuseBillingReality("BILLING_REALITY_VALUE_MISMATCH");
  };
  for (const settlement of candidate.closedTradeSettlements) {
    const fillDigests = new Set([...settlement.openingFillTruthRecordDigests, ...settlement.closingFillTruthRecordDigests,
      ...settlement.partialFillTruthRecordDigests]);
    for (const id of fillDigests) {
      const fact = resolve(id).primitiveAssertion;
      if (fact.kind !== "FILL" || fact.symbol !== settlement.symbol) refuseBillingReality("BILLING_REALITY_PRIMITIVE_MISMATCH");
      if (fact.settlementStatus !== "SETTLED") refuseBillingReality("BILLING_REALITY_FILL_NOT_SETTLED");
    }
    for (const fact of settlement.cashflowFacts) cashflow(fact.truthRecordDigestHex, fact.amount);
    for (const cost of settlement.costFacts) {
      const fact = resolve(cost.truthRecordDigestHex).primitiveAssertion;
      if (fact.kind !== "FILL" || !fillDigests.has(cost.truthRecordDigestHex)) refuseBillingReality("BILLING_REALITY_PRIMITIVE_MISMATCH");
      if (parseDecimal(fact.feeAmount) !== 0n && fact.feeAsset !== "USD") refuseBillingReality("BILLING_REALITY_CONVERSION_REQUIRED");
      if (compareDecimal(cost.amount, fact.feeAmount) !== 0) refuseBillingReality("BILLING_REALITY_VALUE_MISMATCH");
    }
  }
  for (const fact of receipt.nonProfitCashflowFacts) cashflow(fact.truthRecordDigestHex, fact.amount);
  return Object.freeze({ dependenciesMatched: true, binding, economicAttribution: "UNPROVEN", periodCompleteness: "UNPROVEN",
    priorConsumption: "UNPROVEN", realizedFillFinality: "OPERATOR_VERIFICATION_REQUIRED" });
}
