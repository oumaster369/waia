import { describe, expect, it } from "vitest";
import { createRealityProjectionV2, type RealityProjectionEntryV2 } from "@/lib/trader/reality/v2/contracts";
import { createRiskAccountProfileV1, createRiskAccountReferenceV1, riskAccountDigestV1,
  RISK_ACCOUNT_CHANNELS_V1, RISK_REFERENCE_METHOD_V1, sealRiskAccountRecordV1,
  type RiskAccountProfileDraftV1, type RiskReferenceMemberV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import { availableRiskAccountQuantityV1, constructRiskAccountBasisV1, compareExpectedAccountFrontierV1,
  decideCurrentAccountBasisPublicationV1,
  type RiskAccountObligationV1, type RiskExpectedFrontierV1, type RiskIndependentInclusionV1 } from "@/lib/trader/risk/v2/risk-account-reconciliation-v1";

// These pure values exercise arithmetic and refusal contracts only. No persisted authority,
// source qualification, governing envelope, or real upstream issuer is claimed by this fixture.
const org = "00000000-0000-4000-8000-000000000135", source = "00000000-0000-4000-8000-000000000136";
const digest = riskAccountDigestV1, start = "2026-09-27T12:00:00.000Z", end = "2026-09-27T13:00:00.000Z";
const time = (seconds: number) => new Date(Date.parse(start) + seconds * 1000).toISOString();
function fixtureDraft(): RiskAccountProfileDraftV1 {
  const evidence = { sourceId: source, captureReceiptDigest: digest("capture"), storageBindingDigest: digest("storage"),
    validationReceiptDigest: digest("validation"), rawBytesDigest: digest("raw") };
  return { organizationId: org, accountId: "synthetic-spot", credentialId: org, exchangeAccountId: "135",
    accountSourceId: source, venue: "HTX", market: "SPOT", referenceCurrency: "USDT", assets: ["BTC", "USDT"],
    instruments: [{ instrumentIdentityDigestHex: digest("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC",
      quoteAsset: "USDT", referenceSourceId: source }], strategyId: "synthetic-only", strategyVersion: "v1",
    sourceContract: { evidence, statementDigest: digest("contract"), anchorMethod: "INDEPENDENT_SOURCE_ASSERTED_DATED_ACCOUNT",
      validFromUtc: start, validUntilUtc: end, maxSourceAgeMs: 60000, maxReportClockSkewMs: 0,
      coveredAssetSetDigest: digest(["BTC", "USDT"]) },
    mutationBounds: ["BTC", "USDT"].flatMap(asset => RISK_ACCOUNT_CHANNELS_V1.map(channel => ({
      asset, channel, intervalStartUtc: start, intervalEndUtc: end,
      maximumPositiveQuantity: "0.1", maximumNegativeQuantity: "0.1", contractStatementDigest: digest("contract") }))),
    reference: { qualification: { evidence, methodVersion: RISK_REFERENCE_METHOD_V1,
      statementDigest: digest("synthetic-method"), validFromUtc: start, validUntilUtc: end,
      reportTimeSemantics: "HTX_RESPONSE_GENERATION_WITH_QUALIFIED_SIDE_AGE_BOUND", venueDependence: "SINGLE_VENUE_HTX" },
      windowDurationMs: 1000, slotOffsetsMs: [0, 500], slotToleranceMs: 0, maxSideAgeMs: 10, validityMs: 30000 },
    allocation: { evidence, statementDigest: digest("synthetic-allocation"), allocationId: "synthetic-allocation",
      version: "v1", approvedNotional: "1000", allowedSymbols: ["BTC/USDT"], validFromUtc: start, validUntilUtc: end },
    governance: { coolingOffMs: 1, reviewReason: "Synthetic arithmetic fixture only" },
    work: { maxRawBytes: 4096, requestTimeoutMs: 1000, maxPages: 20, maxMembers: 50, maxLedgerEvents: 50, retentionSeconds: 3600 } };
}
function fixture() {
  const profile = createRiskAccountProfileV1(fixtureDraft());
  const members: RiskReferenceMemberV1[] = [0, 1].map(slot => sealRiskAccountRecordV1({
    schemaVersion: "risk-reference-member/v1" as const, organizationId: org, accountId: profile.accountId,
    profileDigest: profile.contentDigest, windowId: "window", slot, instrumentIdentityDigestHex: digest("BTC/USDT"),
    symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT" as const, sourceId: source,
    sourceReportTimeUtc: time(slot / 2), availableAtUtc: time(slot / 2), captureReceiptDigest: digest(`capture-${slot}`),
    storageBindingDigest: digest(`storage-${slot}`), validationReceiptDigest: digest(`validation-${slot}`),
    rawBytesDigest: digest(`raw-${slot}`), rawMemberPath: "tick" as const, decoderVersion: "htx-merged-lossless-scale8/v1",
    normalizedInputDigest: digest(`normal-${slot}`), gatewayReceiptDigest: digest(`gateway-${slot}`),
    observationId: digest(`observation-${slot}`), observationContentDigest: digest(`content-${slot}`),
    trustAsOfReceiptId: digest(`trust-${slot}`), bid: "9", ask: "10", last: "1000" }));
  const reference = createRiskAccountReferenceV1({ profile, windowId: "window", windowStartUtc: start,
    assembledAtUtc: time(1), members });
  return { profile, reference, acquisitionDigest: digest("acquisition"), reality: projection("2", "100"),
    publishedAtUtc: time(2), expected: initialExpected(), predecessor: null, inclusions: [], alreadyDisposedTruthIds: [] } satisfies
    Parameters<typeof constructRiskAccountBasisV1>[0];
}
function initialExpected(): RiskExpectedFrontierV1 { return { stateVersion: "1", nextAdmissionSequence: "1",
  nextEventSequence: "1", eventHeadDigest: null, reconciledExposureNotional: "0", pendingExposureNotional: "0",
  reservationNotional: "0", obligations: [] }; }
function projection(btc: string, quote: string, at = start, extras: RealityProjectionEntryV2[] = []) {
  const entry = (kind: "ACCOUNT" | "BALANCE", key: string, primitive: RealityProjectionEntryV2["primitiveAssertion"]) => ({
    subject: { subjectClass: kind, subjectKey: key }, truthRecordId: digest(`truth-${key}-${at}`),
    sourceReportId: digest(`source-${key}-${at}`), validAtUtc: at, knowledgeAtUtc: at, primitiveAssertion: primitive });
  return createRealityProjectionV2({ organizationId: org, accountId: "synthetic-spot", knowledgeAsOfUtc: at,
    frontierSequence: "1", frontierEventDigestHex: digest(`frontier-${at}`), uncertainties: [], stableEntries: [
      entry("ACCOUNT", "account", { kind: "ACCOUNT", venueAccountId: "135", accountType: "SPOT", accountState: "working", permissions: ["read"] }),
      entry("BALANCE", "BTC", { kind: "BALANCE", asset: "BTC", available: btc, locked: "0", total: btc }),
      entry("BALANCE", "USDT", { kind: "BALANCE", asset: "USDT", available: quote, locked: "0", total: quote }), ...extras,
    ] });
}
function obligation(id: string, quantity: string, side: "BUY" | "SELL" = "SELL"): RiskAccountObligationV1 {
  return { allowanceId: id, allowanceContentDigest: digest(id), verdictId: `verdict-${id}`, verdictContentDigest: digest(`verdict-${id}`),
    instrumentIdentityDigest: digest("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC", side, quantity,
    reservedNotional: side === "BUY" ? "10" : "0", pendingNotional: "0", state: "ISSUED", orderId: null, orderBindingDigest: null };
}

describe("current-account pure arithmetic and refusal values, without durable admission authority", () => {
  it("charges the entire declared external positive window and independently reduces guaranteed inventory", () => {
    const basis = constructRiskAccountBasisV1(fixture());
    expect(basis.accounting).toEqual({ reconciledExposureNotional: "20", worstCasePendingExposureNotional: "7",
      outstandingReservationNotional: "0", exposureLimitNotional: "1000" });
    expect(basis.assets[0]).toMatchObject({ anchorQuantity: "2", upperQuantity: "2.7", guaranteedLowerQuantity: "1.3" });
    expect(basis.validUntilUtc).toBe(time(31));
    expect(basis.reality.validAtUtc).toBe(start);
  });
  it("refuses a forged seal, missing independent account anchor and future or stale anchor", () => {
    const input = fixture();
    expect(() => constructRiskAccountBasisV1({ ...input, reference: { ...input.reference, profileDigest: digest("other") } })).toThrow();
    const empty = createRealityProjectionV2({ organizationId: org, accountId: input.profile.accountId,
      knowledgeAsOfUtc: start, frontierSequence: "0", frontierEventDigestHex: null, stableEntries: [], uncertainties: [] });
    expect(() => constructRiskAccountBasisV1({ ...input, reality: empty })).toThrow("ANCHOR_ACCOUNT_CLASS");
    expect(() => constructRiskAccountBasisV1({ ...input, reality: projection("2", "100", time(3)) })).toThrow("INDEPENDENT_ANCHOR_UNAVAILABLE");
    expect(() => constructRiskAccountBasisV1({ ...input, publishedAtUtc: time(31) })).toThrow("REFERENCE_CURRENTNESS");
  });
  it("will not reset a noninitial Expected state by declaring a new initial basis", () => {
    const input = fixture();
    for (const patch of [{ stateVersion: "2" }, { reconciledExposureNotional: "1" }, { eventHeadDigest: digest("event") },
      { pendingExposureNotional: "1" }, { obligations: [obligation("a", "1")] }])
      expect(() => constructRiskAccountBasisV1({ ...input, expected: { ...input.expected, ...patch } })).toThrow();
  });
  it("preserves standing divergence instead of using positive or negative debt as a tolerance", () => {
    const input = fixture(), prior = constructRiskAccountBasisV1(input);
    expect(() => constructRiskAccountBasisV1({ ...input, predecessor: prior, expected: prior.expected,
      reality: projection("2.1", "100", time(3)), publishedAtUtc: time(4) })).toThrow("STANDING_DIVERGENCE");
  });
  it("charges other SELL obligations, ignores pending BUY as guaranteed inventory and exempts only the exact own SELL once", () => {
    const basis = constructRiskAccountBasisV1(fixture()), own = obligation("own", "0.4"), other = obligation("other", "0.3");
    const obligations = [own, other, obligation("buy", "100", "BUY")];
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC", obligations })).toBe("0.6");
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC", obligations,
      own: { allowanceId: own.allowanceId, allowanceContentDigest: own.allowanceContentDigest,
        orderId: null, quantity: "0.4" } })).toBe("1");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC", obligations,
      own: { allowanceId: "own", allowanceContentDigest: digest("forged"), orderId: null, quantity: "0.4" } })).toThrow("OWN_OBLIGATION_MISMATCH");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC", obligations: [own, own] })).toThrow("DUPLICATE_OBLIGATION");
  });
  it("floors depleted inventory at zero and never exempts a sibling or nonexistent own identity", () => {
    const basis = constructRiskAccountBasisV1(fixture());
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC", obligations: [obligation("other", "2")] })).toBe("0");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC", obligations: [obligation("other", "1")],
      own: { allowanceId: "missing", allowanceContentDigest: digest("missing"), orderId: null, quantity: "1" } })).toThrow("OWN_OBLIGATION_MISSING");
  });
  it("only releases the exact consumed charge after a matching independently settled fill and actual balance comparison", () => {
    const input = fixture(), prior = constructRiskAccountBasisV1(input);
    const consumed: RiskAccountObligationV1 = { ...obligation("own-buy", "1", "BUY"), state: "CONSUMED",
      orderId: "local-order", orderBindingDigest: digest("binding"), pendingNotional: "10" };
    const fact: RiskIndependentInclusionV1 = { allowanceId: consumed.allowanceId, orderId: consumed.orderId!,
      orderBindingDigest: consumed.orderBindingDigest!, truthRecordId: digest("filltruth"), sourceReportId: digest("fillsource"),
      sourceContentDigest: digest("fillsource"), venueTradeId: "trade-1", venueOrderId: "venue-order-1", symbol: "BTC/USDT",
      baseAsset: "BTC", side: "BUY", quantity: "1", price: "10", feeAmount: "1", feeAsset: "USDT",
      validAtUtc: time(3), knowledgeAtUtc: time(3) };
    const entry: RealityProjectionEntryV2 = { subject: { subjectClass: "FILL", subjectKey: "trade-1" },
      truthRecordId: fact.truthRecordId, sourceReportId: fact.sourceReportId, validAtUtc: fact.validAtUtc,
      knowledgeAtUtc: fact.knowledgeAtUtc, primitiveAssertion: { kind: "FILL", venueTradeId: fact.venueTradeId,
        venueOrderId: fact.venueOrderId, symbol: fact.symbol, side: "buy", quantity: fact.quantity, price: fact.price,
        feeAmount: fact.feeAmount, feeAsset: fact.feeAsset, settlementStatus: "SETTLED" } };
    const next = { ...input, predecessor: prior, publishedAtUtc: time(5), reality: projection("3", "89", time(4), [entry]),
      expected: { ...prior.expected, stateVersion: "3", nextAdmissionSequence: "2", nextEventSequence: "3",
        eventHeadDigest: digest("consumed-event"), obligations: [consumed], pendingExposureNotional: "17" }, inclusions: [fact] };
    const basis = constructRiskAccountBasisV1(next);
    expect(basis.accounting.reconciledExposureNotional).toBe("30");
    expect(basis.accounting.worstCasePendingExposureNotional).toBe("7");
    expect(basis.expected.obligations).toHaveLength(0);
    const { contentDigest, ...referenceBody } = input.reference; void contentDigest;
    const nextReference = sealRiskAccountRecordV1({ ...referenceBody, windowId: "next-reference" });
    expect(constructRiskAccountBasisV1({ ...next, reference: nextReference }).expected.obligations).toHaveLength(0);
    expect(() => constructRiskAccountBasisV1({ ...next, alreadyDisposedTruthIds: [fact.truthRecordId] })).toThrow("INDEPENDENT_INCLUSION_IDENTITY");
    expect(() => constructRiskAccountBasisV1({ ...next, inclusions: [{ ...fact, orderId: "sibling" }] })).toThrow("INDEPENDENT_INCLUSION_IDENTITY");
    expect(() => constructRiskAccountBasisV1({ ...next, reality: projection("3", "90", time(4), [entry]) })).toThrow("STANDING_DIVERGENCE");
  });
  it("refuses reference identity drift while any obligation remains and preserves predecessor exposure identity", () => {
    const input = fixture(), prior = constructRiskAccountBasisV1(input), issued = obligation("issued", "1");
    const expected = { ...prior.expected, stateVersion: "2", nextAdmissionSequence: "2", nextEventSequence: "2",
      eventHeadDigest: digest("event"), obligations: [issued] };
    const { contentDigest: _digest, ...body } = input.reference; void _digest;
    const changed = sealRiskAccountRecordV1({ ...body, windowId: "different-window" });
    expect(() => constructRiskAccountBasisV1({ ...input, predecessor: prior, expected, reference: changed }))
      .toThrow("REFERENCE_DRIFT_WITH_OBLIGATIONS");
    expect(() => constructRiskAccountBasisV1({ ...input, predecessor: prior,
      expected: { ...expected, reconciledExposureNotional: "0" } })).toThrow("PREDECESSOR_SCOPE_OR_TIME");
  });
  it("refuses basis publication while the live capital envelope producer is absent", () => {
    expect(decideCurrentAccountBasisPublicationV1({ liveCapitalEnvelope: null, sourceMethodQualified: false }))
      .toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
    expect(decideCurrentAccountBasisPublicationV1({ liveCapitalEnvelope: null, sourceMethodQualified: true }))
      .toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });

  it("reports Expected versus Actual notionals without publishing authority", () => {
    expect(compareExpectedAccountFrontierV1({
      expectedExposureNotional: "10",
      expectedPendingNotional: "1",
      actualExposureNotional: "12",
      actualPendingNotional: "0",
      sourceMethodQualified: true,
    })).toEqual({
      decision: "OBSERVED",
      publication: { decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" },
      exposureDelta: "2",
      pendingDelta: "-1",
    });
  });

});
