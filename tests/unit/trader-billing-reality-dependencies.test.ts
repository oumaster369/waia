import { describe, expect, it } from "vitest";
import { matchBillingRealityDependencies, parseBillingRealityDependencies, snapshotBillingCommand } from "@/lib/trader/billing/v2/reality-dependencies-v1";
import { buildClosedTradeSettlementV2, buildRealizedStrategyProfitReceiptV2 } from "@/lib/trader/billing/v2";
import { createRealityProjectionV2, createRealityEventV2, createRealitySourceReportV2, createTruthRecordV2, validateRealityProjectionV2, validateTruthRecordV2, validateRealityEventV2, validateRealitySourceReportV2 } from "@/lib/trader/reality/v2/contracts";
import { foldRealityProjectionV2 } from "@/lib/trader/reality/v2/projection";
import { billingEvidenceAtProjection, billingFixturePrimitives, fixtureDigest, pureBillingRealityFixture } from "@/tests/helpers/billing-reality-evidence";

const input = { organizationId: "abcdef00-0000-4000-8000-000000001120", accountId: "HTX:exact-account",
  periodStart: new Date("2026-01-01T00:00:00.000Z"), periodEnd: new Date("2026-02-01T00:00:00.000Z"), realizedPnl: "100" };
const run = (f = pureBillingRealityFixture(input)) => matchBillingRealityDependencies({ organizationId: input.organizationId, ...f });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function withoutIdentity<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const result = { ...value }; for (const key of keys) Reflect.deleteProperty(result, key);
  return result as Omit<T, K>;
}
function reseal(f: ReturnType<typeof pureBillingRealityFixture>, patch: Partial<typeof f.candidate.closedTradeSettlements[number]>) {
  const settlement = buildClosedTradeSettlementV2({ ...f.candidate.closedTradeSettlements[0], ...patch });
  const receipt = buildRealizedStrategyProfitReceiptV2({ ...f.candidate.realizedStrategyProfitReceipt, settlements: [settlement] });
  f.candidate = { ...f.candidate, closedTradeSettlements: [settlement], realizedStrategyProfitReceipt: receipt,
    realityDependencies: { ...f.candidate.realityDependencies!, receiptContentDigestHex: receipt.contentDigestHex, closedTradeSettlementDigests: receipt.closedTradeSettlementDigests } };
  return f;
}
describe("DEE1120 required Reality dependency contract (pure consistency only)", () => {
  for (const amount of ["100", "-100", "0", "0.00000001", "999999999999999999.12345678"]) {
    it(`matches a represented ${amount} net without financial authority`, () => {
      const f = pureBillingRealityFixture({ ...input, realizedPnl: amount });
      expect(run(f)).toMatchObject({ dependenciesMatched: true, economicAttribution: "UNPROVEN", periodCompleteness: "UNPROVEN",
        priorConsumption: "UNPROVEN", realizedFillFinality: "OPERATOR_VERIFICATION_REQUIRED" });
      expect(run(f)).not.toHaveProperty("billable");
    });
  }
  for (const binding of [undefined, null]) it(`refuses absent binding ${String(binding)}`, () => {
    expect(() => parseBillingRealityDependencies(binding)).toThrow("BILLING_REALITY_BINDING_REQUIRED");
  });
  for (const [field, value] of [
    ["schemaVersion", "other"], ["frontierBinding", "TRUTH_RECORD"], ["extra", true],
    ["receiptContentDigestHex", "not-a-digest"], ["closedTradeSettlementDigests", []],
  ] as const) it(`refuses malformed/mismatched binding ${field}`, () => {
    const f = pureBillingRealityFixture(input);
    f.candidate.realityDependencies = { ...f.candidate.realityDependencies!, [field]: value } as typeof f.candidate.realityDependencies;
    expect(() => run(f)).toThrow(/BILLING_REALITY_/);
  });
  for (const [field, value] of [
    ["projectionId", fixtureDigest("wrong")], ["contentDigestHex", fixtureDigest("wrong")],
    ["projectionPolicyVersion", "unratified"], ["knowledgeAsOfUtc", "2026-01-02T00:00:01.000Z"],
    ["frontierSequence", "1"], ["frontierSequence", "01"], ["frontierEventDigestHex", fixtureDigest("wrong")],
  ] as const) it(`refuses mismatched projection tuple ${field}:${value}`, () => {
    const f = pureBillingRealityFixture(input);
    f.candidate.realityDependencies = { ...f.candidate.realityDependencies!, projection: { ...f.candidate.realityDependencies!.projection, [field]: value } };
    expect(() => run(f)).toThrow(/BILLING_REALITY_/);
  });
  for (const organizationId of [input.organizationId.toUpperCase(), `{${input.organizationId}}`, input.organizationId.replaceAll("-", "")]) {
    it(`refuses UUID alias before lock use: ${organizationId}`, () => {
      expect(() => matchBillingRealityDependencies({ ...pureBillingRealityFixture(input), organizationId })).toThrow("BILLING_REALITY_SCOPE_INVALID");
    });
  }
  it("does not reinterpret an individual truth digest as a saved projection", () => {
    const f = pureBillingRealityFixture(input);
    reseal(f, { realityFrontierDigestHex: f.ledger.truths.at(-1)!.contentDigestHex });
    expect(() => run(f)).toThrow("BILLING_REALITY_LEGACY_FRONTIER_REFUSED");
  });
  it("checks each settlement frontier even when the receipt claims the correct projection", () => {
    const f = pureBillingRealityFixture(input);
    expect(() => run(reseal(f, { realityFrontierDigestHex: fixtureDigest("fake") }))).toThrow("BILLING_REALITY_LEGACY_FRONTIER_REFUSED");
  });
  for (const field of ["openingFillTruthRecordDigests", "closingFillTruthRecordDigests", "partialFillTruthRecordDigests"] as const) {
    it(`requires active stored ${field}`, () => {
      const f = pureBillingRealityFixture(input);
      expect(() => run(reseal(f, { [field]: [fixtureDigest("absent")] }))).toThrow("BILLING_REALITY_FACT_INACTIVE");
    });
  }
  it("rejects a re-sealed invented cashflow amount", () => {
    const f = pureBillingRealityFixture(input);
    expect(() => run(reseal(f, { cashflowFacts: [{ ...f.candidate.closedTradeSettlements[0].cashflowFacts[0], amount: "1000" }] })))
      .toThrow("BILLING_REALITY_VALUE_MISMATCH");
  });
  it("rejects a re-sealed invented cost", () => {
    const f = pureBillingRealityFixture(input);
    expect(() => run(reseal(f, { costFacts: [{ ...f.candidate.closedTradeSettlements[0].costFacts[0], amount: "1" }] })))
      .toThrow("BILLING_REALITY_VALUE_MISMATCH");
  });
  it("cannot substitute a fill as a monetary cashflow", () => {
    const f = pureBillingRealityFixture(input);
    expect(() => run(reseal(f, { cashflowFacts: [{ truthRecordDigestHex: f.ledger.truths[0].contentDigestHex, amount: "100", cause: "STRATEGY_REALIZED" }] })))
      .toThrow("BILLING_REALITY_PRIMITIVE_MISMATCH");
  });
  for (const variant of ["cashflow-currency", "cost-currency", "observed", "symbol"] as const) it(`rejects unsupported stored ${variant}`, () => {
    const primitives = billingFixturePrimitives("100");
    if (primitives[0].kind !== "FILL" || primitives[2].kind !== "REALIZED_CASHFLOW") throw new Error("fixture");
    if (variant === "cashflow-currency") primitives[2] = { ...primitives[2], asset: "USDT" };
    if (variant === "cost-currency") primitives[0] = { ...primitives[0], feeAmount: "1", feeAsset: "BTC" };
    if (variant === "observed") primitives[0] = { ...primitives[0], settlementStatus: "OBSERVED" };
    if (variant === "symbol") primitives[0] = { ...primitives[0], symbol: "ETHUSDT" };
    expect(() => run(pureBillingRealityFixture(input, primitives))).toThrow(/BILLING_REALITY_/);
  });
  it("preserves actual zero fee in a non-USD asset", () => {
    const primitives = billingFixturePrimitives("100");
    if (primitives[0].kind !== "FILL") throw new Error("fixture");
    primitives[0] = { ...primitives[0], feeAsset: "BTC" };
    expect(run(pureBillingRealityFixture(input, primitives)).dependenciesMatched).toBe(true);
  });
  it("rejects a valid saved projection lagging the current event head", () => {
    const f = pureBillingRealityFixture(input);
    f.ledger.events = [...f.ledger.events, { ...f.ledger.events.at(-1)!, eventSequence: "4" }];
    expect(() => run(f)).toThrow("BILLING_REALITY_FRONTIER_STALE");
  });
  it("rejects a resealed projection that is not the actual fold", () => {
    const f = pureBillingRealityFixture(input);
    f.projection = createRealityProjectionV2({ ...withoutIdentity(f.projection, "projectionId", "contentDigestHex", "schemaVersion", "projectionPolicyVersion"), stableEntries: [] });
    f.candidate = { ...f.candidate, realityDependencies: { ...f.candidate.realityDependencies!, projection: {
      ...f.candidate.realityDependencies!.projection, projectionId: f.projection.projectionId, contentDigestHex: f.projection.contentDigestHex } } };
    const settlement = buildClosedTradeSettlementV2({ ...f.candidate.closedTradeSettlements[0], realityFrontierDigestHex: f.projection.contentDigestHex });
    const receipt = buildRealizedStrategyProfitReceiptV2({ ...f.candidate.realizedStrategyProfitReceipt, realityFrontierDigestHex: f.projection.contentDigestHex, settlements: [settlement] });
    f.candidate = { ...f.candidate, realizedStrategyProfitReceipt: receipt, closedTradeSettlements: [settlement], realityDependencies: {
      ...f.candidate.realityDependencies!, receiptContentDigestHex: receipt.contentDigestHex, closedTradeSettlementDigests: receipt.closedTradeSettlementDigests } };
    expect(() => run(f)).toThrow("BILLING_REALITY_LEDGER_INVALID");
  });
  it("resolves non-profit dependencies without authenticating their economic cause", () => {
    const f = pureBillingRealityFixture(input);
    const receipt = buildRealizedStrategyProfitReceiptV2({ ...f.candidate.realizedStrategyProfitReceipt, settlements: f.candidate.closedTradeSettlements,
      nonProfitCashflowFacts: [{ truthRecordDigestHex: fixtureDigest("missing-nonprofit"), amount: "1", cause: "DEPOSIT" }] });
    f.candidate = { ...f.candidate, realizedStrategyProfitReceipt: receipt, realityDependencies: { ...f.candidate.realityDependencies!, receiptContentDigestHex: receipt.contentDigestHex } };
    expect(() => run(f)).toThrow("BILLING_REALITY_FACT_INACTIVE");
  });
  it("copies nested receipts, arrays, context and Date values", () => {
    const original = { context: { organizationId: input.organizationId }, candidate: clone(pureBillingRealityFixture(input).candidate), at: new Date(input.periodStart) };
    const snapshot = snapshotBillingCommand(original);
    original.context.organizationId = "changed";
    original.candidate.closedTradeSettlements = [];
    original.at.setFullYear(2020);
    expect(snapshot.context.organizationId).toBe(input.organizationId);
    expect(snapshot.candidate.closedTradeSettlements).toHaveLength(1);
    expect(snapshot.at.toISOString()).toBe(input.periodStart.toISOString());
  });
  it("keeps equal-valued independently identified cashflows as two dependencies", () => {
    const primitives = billingFixturePrimitives("100");
    primitives.push({ ...primitives[2]!, cashflowId: "second-equal-cashflow" } as typeof primitives[number]);
    const f = pureBillingRealityFixture({ ...input, realizedPnl: "200" }, primitives);
    expect(f.candidate.realizedStrategyProfitReceipt.netRealizedStrategyProfit).toBe("200");
    expect(f.candidate.closedTradeSettlements[0]!.cashflowFacts).toHaveLength(2);
    expect(run(f).dependenciesMatched).toBe(true);
  });
  it.each(["sources", "truths", "events"] as const)("rejects a mutated saved %s body under its old seal", (collection) => {
    const f = clone(pureBillingRealityFixture(input));
    if (collection === "events") f.ledger.events[0] = { ...f.ledger.events[0]!, reasonCodes: ["MUTATED"] };
    else f.ledger[collection][0] = { ...f.ledger[collection][0]!, validAtUtc: "2025-01-01T00:00:00.000Z" };
    expect(() => run(f)).toThrow("BILLING_REALITY_LEDGER_INVALID");
  });
  it("rejects a resealed truth whose semantic body disagrees with its persisted source", () => {
    const f = pureBillingRealityFixture(input); const old = f.ledger.truths[2]!;
    const altered = createTruthRecordV2({ ...withoutIdentity(old, "truthRecordId", "contentDigestHex", "schemaVersion"), primitiveAssertion: { ...old.primitiveAssertion, amount: "1000" } as typeof old.primitiveAssertion });
    f.ledger.truths[2] = altered;
    const last = createRealityEventV2({ ...withoutIdentity(f.ledger.events[2]!, "realityEventId", "contentDigestHex", "schemaVersion"), truthRecordId: altered.truthRecordId });
    f.ledger.events[2] = last;
    f.projection = createRealityProjectionV2({ ...withoutIdentity(f.projection, "projectionId", "contentDigestHex", "schemaVersion", "projectionPolicyVersion"), frontierEventDigestHex: last.contentDigestHex,
      stableEntries: f.projection.stableEntries.map((entry) => entry.truthRecordId === old.truthRecordId ? { ...entry,
        truthRecordId: altered.truthRecordId, primitiveAssertion: altered.primitiveAssertion } : entry) });
    const settlement = buildClosedTradeSettlementV2({ ...f.candidate.closedTradeSettlements[0]!, realityFrontierDigestHex: f.projection.contentDigestHex,
      cashflowFacts: [{ truthRecordDigestHex: altered.contentDigestHex, amount: "1000", cause: "STRATEGY_REALIZED" }] });
    const receipt = buildRealizedStrategyProfitReceiptV2({ ...f.candidate.realizedStrategyProfitReceipt,
      realityFrontierDigestHex: f.projection.contentDigestHex, settlements: [settlement] });
    f.candidate = { ...f.candidate, realizedStrategyProfitReceipt: receipt, closedTradeSettlements: [settlement], realityDependencies: {
      ...f.candidate.realityDependencies!, receiptContentDigestHex: receipt.contentDigestHex, closedTradeSettlementDigests: receipt.closedTradeSettlementDigests,
      projection: { ...f.candidate.realityDependencies!.projection, projectionId: f.projection.projectionId,
        contentDigestHex: f.projection.contentDigestHex, frontierEventDigestHex: last.contentDigestHex } } };
    expect(validateTruthRecordV2(altered)).toBe(true); expect(validateRealityEventV2(last)).toBe(true);
    expect(validateRealityProjectionV2(f.projection)).toBe(true);
    expect(() => run(f)).toThrow("BILLING_REALITY_SOURCE_MISMATCH");
  });
  it("rejects an event-chain gap even when the final tuple remains unchanged", () => {
    const f = pureBillingRealityFixture(input); f.ledger.events.splice(1, 1);
    expect(() => run(f)).toThrow("BILLING_REALITY_LEDGER_INVALID");
  });
  it.each(["missing", "extra", "duplicate"])("refuses %s settlement behind an otherwise valid binding", (kind) => {
    const f = pureBillingRealityFixture(input); const settlement = f.candidate.closedTradeSettlements[0]!;
    f.candidate.closedTradeSettlements = kind === "missing" ? [] : kind === "duplicate" ? [settlement, settlement] : [settlement,
      buildClosedTradeSettlementV2({ ...settlement, lifecycleId: "extra" })];
    expect(() => run(f)).toThrow();
  });

  // General fold-valid vocabulary control: the current high-level HTX ingest
  // chooses same-subject contradictions; this is not a claim it emits this shape.
  it("follows exact related stable-truth uncertainty even when subject and source differ", () => {
    const f = pureBillingRealityFixture(input); const selected = f.ledger.truths[2]!;
    const source = createRealitySourceReportV2({ ...withoutIdentity(f.ledger.sources[2]!, "sourceReportId", "contentDigestHex", "schemaVersion"), subject: { ...selected.subject, subjectKey: "different-unselected-subject" },
      sourceNativeIdentity: { ...selected.sourceNativeIdentity!, nativeId: "different-unselected-source" },
      knowledgeAtUtc: "2026-01-02T00:01:00.000Z" });
    const truth = createTruthRecordV2({ ...withoutIdentity(selected, "truthRecordId", "contentDigestHex", "schemaVersion"), sourceReportId: source.sourceReportId, sourceReportDigestHex: source.contentDigestHex,
      sourceNativeIdentity: source.sourceNativeIdentity, subject: source.subject, knowledgeAtUtc: source.knowledgeAtUtc,
      markers: ["SOURCE_CONTRADICTION"] });
    const event = createRealityEventV2({ ...withoutIdentity(f.ledger.events[2]!, "realityEventId", "contentDigestHex", "schemaVersion"), eventSequence: "4", eventType: "SOURCE_CONTRADICTION",
      sourceReportId: source.sourceReportId, truthRecordId: truth.truthRecordId, relatedTruthRecordId: selected.truthRecordId,
      knowledgeAtUtc: "2026-01-02T00:01:01.000Z", previousEventDigestHex: f.ledger.events[2]!.contentDigestHex,
      reasonCodes: ["SOURCE_ASSERTION_CONTRADICTION"] });
    expect(validateRealitySourceReportV2(source)).toBe(true);
    expect(validateTruthRecordV2(truth)).toBe(true); expect(validateRealityEventV2(event)).toBe(true);
    f.ledger.sources.push(source); f.ledger.truths.push(truth); f.ledger.events.push(event);
    f.projection = foldRealityProjectionV2({ organizationId: input.organizationId, accountId: input.accountId }, event.knowledgeAtUtc, f.ledger);
    f.candidate = billingEvidenceAtProjection(input, f.projection, f.ledger.truths.slice(0, 3));
    expect(validateRealityProjectionV2(f.projection)).toBe(true);
    expect(f.projection.uncertainties[0]!.sourceReportId).not.toBe(selected.sourceReportId);
    expect(f.projection.uncertainties[0]!.subject).not.toEqual(selected.subject);
    expect(() => run(f)).toThrow("BILLING_REALITY_FACT_UNCERTAIN");
  });

});
