import { createHash } from "node:crypto";
import { buildClosedTradeSettlementV2, buildRealizedStrategyProfitReceiptV2, billingPeriodReportingScopeIdV2 } from "@/lib/trader/billing/v2";
import { BILLING_REALITY_DEPENDENCIES_V1, type BillingRealityDependenciesV1 } from "@/lib/trader/billing/v2/reality-dependencies-v1";
import { createRealityEventV2, createRealitySourceReportV2, createTruthRecordV2,
  type RealityPrimitiveAssertionV2, type RealityProjectionV2, type TruthRecordV2, type RealitySourceLineageV2 } from "@/lib/trader/reality/v2/contracts";
import { foldRealityProjectionV2 } from "@/lib/trader/reality/v2/projection";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import type { CloseReportingPeriodInput } from "@/lib/trader/billing/reporting-period-repository.types";

export type BillingRealityFixtureInput = { organizationId: string; accountId: string; periodStart: Date; periodEnd: Date;
  realizedPnl: string; unrealizedPnl?: string; endingEquity?: string; endingSnapshotAt?: Date; netDeposits?: string; netWithdrawals?: string; lifecycleId?: string };
export const fixtureDigest = (label: string) => createHash("sha256").update(label).digest("hex");
export function billingFixturePrimitives(amount: string): RealityPrimitiveAssertionV2[] {
  const pnl = parseDecimal(amount);
  return [
    ...(["buy", "sell"] as const).map((side) => ({ kind: "FILL" as const, venueTradeId: side,
      venueOrderId: `${side}-order`, symbol: "BTCUSDT", side, quantity: "1", price: "100", feeAmount: "0", feeAsset: "USD", settlementStatus: "SETTLED" as const })),
    { kind: "REALIZED_CASHFLOW", cashflowId: "cash", asset: "USD", amount: formatDecimal(pnl === 0n ? 1n * 100000000n : pnl < 0n ? -pnl : pnl),
      direction: pnl < 0n ? "OUTFLOW" : "INFLOW", causeNativeId: "synthetic-lifecycle-unproven" },
    ...(pnl === 0n ? [{ kind: "REALIZED_CASHFLOW" as const, cashflowId: "offset", asset: "USD", amount: "1", direction: "OUTFLOW" as const,
      causeNativeId: "synthetic-lifecycle-unproven" }] : []),
  ];
}
export function billingFixtureSource(assertion: RealityPrimitiveAssertionV2, label: string, lineage: RealitySourceLineageV2) {
  return { sourceKind: "HTX_SPOT_FILL_REST" as const, sourceNativeIdentity: { identityKind: "HTX_TRADE_ID" as const,
    nativeId: label, nativeRevision: null, supersedesNativeRevision: null }, attributionStatus: "ATTRIBUTED" as const,
    subject: { subjectClass: assertion.kind, subjectKey: `fixture:${label}` }, primitiveAssertion: assertion, lineage,
    provenance: { venue: "HTX" as const, transport: "REST" as const, connectorId: "htx-exchange-connector", connectorVersion: "test-v1",
      adapterVersion: "reality-htx-spot-v1", sourceFinalityMetadata: [] as const }, structuralVerification: "VERIFIED" as const,
    verificationReasonCodes: [], validAtUtc: "2026-01-01T00:00:00.000Z" };
}
export function billingEvidenceAtProjection(input: BillingRealityFixtureInput, projection: RealityProjectionV2, truths: readonly TruthRecordV2[]): CloseReportingPeriodInput & { unrealizedPnl: string } {
  const fills = truths.filter((t) => t.primitiveAssertion.kind === "FILL");
  const settlement = buildClosedTradeSettlementV2({ organizationId: input.organizationId, accountId: input.accountId,
    strategyId: "strat-period-close", symbol: "BTCUSDT", lifecycleId: input.lifecycleId ?? `synthetic/${input.periodStart.toISOString()}`,
    lifecycleState: "FULLY_CLOSED", remainingQuantity: "0", realityFrontierDigestHex: projection.contentDigestHex,
    openingFillTruthRecordDigests: fills.filter((t) => t.primitiveAssertion.kind === "FILL" && t.primitiveAssertion.side === "buy").map((t) => t.contentDigestHex),
    closingFillTruthRecordDigests: fills.filter((t) => t.primitiveAssertion.kind === "FILL" && t.primitiveAssertion.side === "sell").map((t) => t.contentDigestHex),
    partialFillTruthRecordDigests: [], costFacts: fills.map((t) => ({ truthRecordDigestHex: t.contentDigestHex,
      amount: t.primitiveAssertion.kind === "FILL" ? t.primitiveAssertion.feeAmount : "0", admitted: true })),
    cashflowFacts: truths.flatMap((t) => t.primitiveAssertion.kind === "REALIZED_CASHFLOW" ? [{ truthRecordDigestHex: t.contentDigestHex,
      amount: formatDecimal(parseDecimal(t.primitiveAssertion.amount) * (t.primitiveAssertion.direction === "INFLOW" ? 1n : -1n)), cause: "STRATEGY_REALIZED" as const }] : []),
    supersedesSettlementDigestHex: null });
  const receipt = buildRealizedStrategyProfitReceiptV2({ organizationId: input.organizationId, accountId: input.accountId,
    strategyId: settlement.strategyId, reportingScopeId: billingPeriodReportingScopeIdV2(input), realityFrontierDigestHex: projection.contentDigestHex,
    settlements: [settlement] });
  const binding: BillingRealityDependenciesV1 = { schemaVersion: BILLING_REALITY_DEPENDENCIES_V1,
    frontierBinding: "REALITY_PROJECTION_CONTENT_DIGEST_V2", receiptContentDigestHex: receipt.contentDigestHex,
    closedTradeSettlementDigests: receipt.closedTradeSettlementDigests, projection: { projectionId: projection.projectionId,
      contentDigestHex: projection.contentDigestHex, projectionPolicyVersion: projection.projectionPolicyVersion,
      knowledgeAsOfUtc: projection.knowledgeAsOfUtc, frontierSequence: projection.frontierSequence, frontierEventDigestHex: projection.frontierEventDigestHex! } };
  return { exchangeAccountId: input.accountId, periodEnd: input.periodEnd, endingEquity: input.endingEquity ?? "10100.00",
    endingSnapshotAt: input.endingSnapshotAt ?? input.periodEnd, realizedPnl: input.realizedPnl, unrealizedPnl: input.unrealizedPnl ?? "0",
    netDeposits: input.netDeposits, netWithdrawals: input.netWithdrawals,
    realizedStrategyProfitReceipt: receipt, closedTradeSettlements: [settlement], realityDependencies: binding };
}

/** In-memory source consistency fixture only; it cannot pass the stored reader. */
export function pureBillingRealityFixture(input: BillingRealityFixtureInput, primitives = billingFixturePrimitives(input.realizedPnl)) {
  const sources = primitives.map((p, i) => createRealitySourceReportV2({ ...billingFixtureSource(p, `pure-${i}`, {
    lineageKind: "RAW_CAPTURE_V1", rawCaptureSourceId: "00000000-0000-4000-8000-000000001120", rawCaptureReceiptDigestHex: fixtureDigest(`receipt-${i}`),
    rawBytesDigestHex: fixtureDigest(`bytes-${i}`), storageBindingDigestHex: fixtureDigest(`storage-${i}`) }),
    organizationId: input.organizationId, accountId: input.accountId, knowledgeAtUtc: new Date(Date.UTC(2026, 0, 2, 0, 0, 2 * i)).toISOString() }));
  const truths = sources.map((s) => createTruthRecordV2({ organizationId: s.organizationId, accountId: s.accountId,
    sourceReportId: s.sourceReportId, sourceReportDigestHex: s.contentDigestHex, sourceKind: s.sourceKind, sourceNativeIdentity: s.sourceNativeIdentity,
    subject: s.subject, primitiveAssertion: s.primitiveAssertion!, validAtUtc: s.validAtUtc, knowledgeAtUtc: s.knowledgeAtUtc, supersedesTruthRecordId: null, markers: [] }));
  const events: ReturnType<typeof createRealityEventV2>[] = [];
  for (const [i, t] of truths.entries()) events.push(createRealityEventV2({ organizationId: t.organizationId, accountId: t.accountId,
    eventSequence: String(i + 1), eventType: "OBSERVED", sourceReportId: t.sourceReportId, truthRecordId: t.truthRecordId,
    relatedTruthRecordId: null, quarantineEventId: null, reasonCodes: [], knowledgeAtUtc: new Date(Date.UTC(2026, 0, 2, 0, 0, 2 * i + 1)).toISOString(),
    previousEventDigestHex: events.at(-1)?.contentDigestHex ?? null }));
  const ledger = { sources, truths, events };
  const projection = foldRealityProjectionV2({ organizationId: input.organizationId, accountId: input.accountId }, events.at(-1)!.knowledgeAtUtc, ledger);
  return { ledger, projection, candidate: billingEvidenceAtProjection(input, projection, truths) };
}
