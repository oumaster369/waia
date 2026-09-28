import { admitFoldedSuffixV1, admitOpenProfileFrontierV1, decideRiskAccountProfileCommandV1 } from "@/lib/trader/risk/v2/risk-account-profile-command-v1";
import { classifyCurrentAccountRowV1 } from "@/lib/trader/risk/v2/risk-current-account-read-v1";
import { describe, expect, it } from "vitest";
import { createRealityProjectionV2, type RealityProjectionEntryV2 } from "@/lib/trader/reality/v2/contracts";
import { createRiskAccountProfileV1, createRiskAccountReferenceV1, riskAccountDigestV1,
  RISK_ACCOUNT_CHANNELS_V1, RISK_REFERENCE_METHOD_V1, RiskCurrentAccountRefusedV1, sealRiskAccountRecordV1,
  type RiskAccountProfileDraftV1, type RiskReferenceMemberV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import { availableRiskAccountQuantityV1, constructRiskAccountBasisV1, compareExpectedAccountFrontierV1,
  admitCurrentAccountBasisV1, authenticateExpectedEventSuffixV1, decideCurrentAccountBasisPublicationV1, foldExpectedEnforcementSuffixV1, holdUnpublishedInclusionsV1, observeSealedExpectedFrontierV1, retainObservedFrontierV1,
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
function basisHolding(obligations: RiskAccountObligationV1[]) {
  const input = fixture(), prior = constructRiskAccountBasisV1(input);
  const reservation = obligations.reduce((sum, row) => sum + Number(row.reservedNotional), 0);
  return constructRiskAccountBasisV1({ ...input, predecessor: prior, publishedAtUtc: time(3),
    expected: { ...prior.expected, stateVersion: "2", nextAdmissionSequence: "2", nextEventSequence: "2",
      eventHeadDigest: digest("held"), reconciledExposureNotional: prior.accounting.reconciledExposureNotional,
      pendingExposureNotional: prior.externalDebtNotional, reservationNotional: String(reservation), obligations } });
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
  it("reads sealed obligations, exempts only the exact own SELL, and ignores a BUY as inventory", () => {
    const own = obligation("own", "0.4"), sibling = obligation("sibling", "0.8");
    const basis = basisHolding([own, sibling, obligation("buy", "100", "BUY")]);
    const exact = { allowanceId: own.allowanceId, allowanceContentDigest: own.allowanceContentDigest, orderId: null, quantity: "0.4" };
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC" })).toBe("0.1");
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC", own: exact })).toBe("0.5");
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC", own: exact })).toBe("0.5");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC",
      own: { ...exact, allowanceContentDigest: digest("forged") } })).toThrow("OWN_OBLIGATION_MISMATCH");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC",
      own: { ...exact, quantity: "0.1" } })).toThrow("OWN_OBLIGATION_MISMATCH");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC",
      own: { ...exact, orderId: "other-order" } })).toThrow("OWN_OBLIGATION_MISMATCH");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC",
      own: { allowanceId: "buy", allowanceContentDigest: digest("buy"), orderId: null, quantity: "100" } })).toThrow("OWN_OBLIGATION_MISSING");
  });
  it("floors two competing reductions and still charges the sibling when one identity is rechecked", () => {
    const basis = basisHolding([obligation("a", "0.8"), obligation("b", "0.8")]);
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC" })).toBe("0");
    expect(availableRiskAccountQuantityV1({ basis, asset: "BTC",
      own: { allowanceId: "a", allowanceContentDigest: digest("a"), orderId: null, quantity: "0.8" } })).toBe("0.5");
    expect(() => availableRiskAccountQuantityV1({ basis, asset: "BTC",
      own: { allowanceId: "missing", allowanceContentDigest: digest("missing"), orderId: null, quantity: "0.8" } })).toThrow("OWN_OBLIGATION_MISSING");
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
    expect(retainObservedFrontierV1(compareExpectedAccountFrontierV1({
      expectedExposureNotional: "10", expectedPendingNotional: "1",
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false,
    }))).toEqual({ currentPointer: null, basisWrite: null, retention: "DELTA_ONLY" });
    const retained = retainObservedFrontierV1(compareExpectedAccountFrontierV1({
      expectedExposureNotional: "10", expectedPendingNotional: "1",
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: true,
    }));
    expect(admitCurrentAccountBasisV1(retained)).toEqual({
      decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT", allowanceId: null, orderId: null,
    });
  });
  it("treats a missing or baseless current row as not current", () => {
    expect(classifyCurrentAccountRowV1(null)).toEqual({ current: false, reason: "NO_CURRENT_POINTER" });
    expect(classifyCurrentAccountRowV1({ basis_digest: null })).toEqual({ current: false, reason: "BASIS_ABSENT" });
    expect(classifyCurrentAccountRowV1({ basis_digest: "ab".repeat(32) })).toEqual({
      current: false, reason: "LIVE_CAPITAL_ENVELOPE_ABSENT", basisDigest: "ab".repeat(32),
    });
  });
  it("keeps profile propose non-authoritative and refuses activation", () => {
    expect(decideRiskAccountProfileCommandV1({ action: "PROPOSE", liveCapitalEnvelope: null })).toEqual({
      decision: "NON_AUTHORITY", action: "PROPOSE", currentPointer: null, basisWrite: null, allowanceId: null, orderId: null,
    });
    expect(() => decideRiskAccountProfileCommandV1({ action: "ACTIVATE", liveCapitalEnvelope: null })).toThrow(RiskCurrentAccountRefusedV1);
  });
  it("observes a sealed Expected frontier without publishing a limit", () => {
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" };
    expect(observeSealedExpectedFrontierV1({
      expected, actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: true,
      externalDebtNotional: null,
    })).toEqual({
      decision: "OBSERVED",
      publication: { decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" },
      exposureDelta: "2", pendingDelta: "-1",
    });
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, reservationNotional: "1" },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false,
      externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected, actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false,
      externalDebtNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected, actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false,
      externalDebtNotional: "1",
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("holds a new inclusion unpublished and refuses a repeated truth record", () => {
    const id = digest("inclusion-once");
    expect(holdUnpublishedInclusionsV1({ truthRecordIds: [id], alreadyDisposedTruthIds: [] })).toEqual({
      disposition: "HELD_UNPUBLISHED", truthRecordIds: [id], inclusionWrite: null, currentPointer: null,
    });
    expect(() => holdUnpublishedInclusionsV1({ truthRecordIds: [id], alreadyDisposedTruthIds: [id] })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => holdUnpublishedInclusionsV1({ truthRecordIds: [id, id], alreadyDisposedTruthIds: [] })).toThrow(RiskCurrentAccountRefusedV1);
  });
  it("refuses a consumed obligation whose order binding is not a digest", () => {
    const consumed = { ...obligation("allow-1", "1", "BUY"), state: "CONSUMED" as const, orderId: "order-1",
      orderBindingDigest: digest("bind-1"), pendingNotional: "1", reservedNotional: "0" };
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1", obligations: [consumed] };
    expect(observeSealedExpectedFrontierV1({
      expected, actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0", referenceDigest: digest("ref-1"), priorReferenceDigest: null,
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, obligations: [{ ...consumed, orderBindingDigest: "not-a-digest" }] },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0", referenceDigest: digest("ref-1"), priorReferenceDigest: null,
    })).toThrow();
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, obligations: [consumed, { ...consumed, allowanceId: "allow-2" }] },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0", referenceDigest: digest("ref-1"), priorReferenceDigest: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, obligations: [{ ...consumed, quantity: "0" }] },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0", referenceDigest: digest("ref-1"), priorReferenceDigest: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, obligations: [{ ...consumed, symbol: "ETH/USDT" }] },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0", referenceDigest: digest("ref-1"), priorReferenceDigest: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, obligations: [{ ...consumed, instrumentIdentityDigest: "not-a-digest" }] },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0", referenceDigest: digest("ref-1"), priorReferenceDigest: null,
    })).toThrow();
    expect(() => observeSealedExpectedFrontierV1({
      expected, actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected, actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0",
      referenceDigest: digest("ref-1"), priorReferenceDigest: digest("ref-2"),
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected, actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0",
      referenceDigest: digest("ref-1"), priorReferenceDigest: digest("ref-1"),
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("refuses an Expected frontier that rewinds a predecessor sequence", () => {
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" };
    expect(() => observeSealedExpectedFrontierV1({
      expected, predecessor: { ...initialExpected(), stateVersion: "2" },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected, predecessor: initialExpected(),
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("refuses an Expected frontier that disagrees with attested prior exposure", () => {
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" };
    expect(() => observeSealedExpectedFrontierV1({
      expected, priorReconciledExposureNotional: "9",
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected, priorReconciledExposureNotional: "10",
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("refuses an event head that disagrees with the next event sequence", () => {
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" };
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, eventHeadDigest: digest("head") },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, nextEventSequence: "2" },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected: { ...expected, nextEventSequence: "2", eventHeadDigest: digest("head") },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("refuses a predecessor whose event head disagrees with its sequence", () => {
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1",
      nextEventSequence: "2", eventHeadDigest: digest("head") };
    expect(() => observeSealedExpectedFrontierV1({
      expected, predecessor: { ...initialExpected(), nextEventSequence: "2" },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected, predecessor: { ...initialExpected(), nextEventSequence: "2", eventHeadDigest: digest("head") },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
    expect(() => observeSealedExpectedFrontierV1({
      expected, predecessor: { ...initialExpected(), nextEventSequence: "2", eventHeadDigest: digest("prior-head") },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...expected, nextEventSequence: "3", eventHeadDigest: digest("head") },
      predecessor: { ...initialExpected(), nextEventSequence: "2", eventHeadDigest: digest("head") },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected: { ...expected, nextEventSequence: "3", eventHeadDigest: digest("next-head") },
      predecessor: { ...initialExpected(), nextEventSequence: "2", eventHeadDigest: digest("head") },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("refuses a predecessor obligation that fails the same identity rules", () => {
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" };
    expect(() => observeSealedExpectedFrontierV1({
      expected, predecessor: { ...initialExpected(), obligations: [obligation("allow-1", "0", "BUY")] },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected, predecessor: { ...initialExpected(), reservationNotional: "1" },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected, predecessor: { ...initialExpected(), reservationNotional: "10", obligations: [obligation("allow-1", "1", "BUY")] },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    })).toThrow(RiskCurrentAccountRefusedV1);
  });
  it("does not treat an unattested predecessor debt as zero", () => {
    const expected = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" };
    const predecessor = { ...initialExpected(), pendingExposureNotional: "4" };
    expect(() => observeSealedExpectedFrontierV1({
      expected, predecessor, priorExternalDebtNotional: "0",
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected, priorExternalDebtNotional: "4",
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected, predecessor, priorExternalDebtNotional: "4",
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("refuses a current obligation that repeats a consumed predecessor order", () => {
    const consumed = { ...obligation("allow-1", "1", "BUY"), state: "CONSUMED" as const, orderId: "order-1",
      orderBindingDigest: digest("bind-1"), pendingNotional: "1", reservedNotional: "0" };
    const predecessor = { ...initialExpected(), pendingExposureNotional: "1", obligations: [consumed] };
    const base = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" };
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...base, obligations: [consumed] }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
      referenceDigest: digest("ref-1"),
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...base, obligations: [{ ...consumed, allowanceId: "allow-3" }] }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
      referenceDigest: digest("ref-1"),
    })).toThrow(RiskCurrentAccountRefusedV1);
    const fresh = { ...consumed, allowanceId: "allow-2", orderId: "order-2" };
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...base, obligations: [fresh] }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0",
      referenceDigest: digest("ref-1"),
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected: { ...base, nextAdmissionSequence: "2", obligations: [fresh] }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "0",
      referenceDigest: digest("ref-1"),
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });
  it("keeps an issued predecessor obligation on the current frontier", () => {
    const issued = obligation("allow-1", "1", "BUY");
    const predecessor = { ...initialExpected(), reservationNotional: "10", obligations: [issued] };
    const carried = { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1",
      reservationNotional: "10", obligations: [issued] };
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: null,
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...carried, obligations: [{ ...issued, quantity: "2" }] }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
      referenceDigest: digest("ref-1"),
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...carried, obligations: [{ ...issued, instrumentIdentityDigest: digest("other-instrument") }] }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
      referenceDigest: digest("ref-1"),
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => observeSealedExpectedFrontierV1({
      expected: { ...carried, obligations: [{ ...issued, verdictId: "verdict-other" }] }, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
      referenceDigest: digest("ref-1"),
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(observeSealedExpectedFrontierV1({
      expected: carried, predecessor,
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
      referenceDigest: digest("ref-1"),
    }).publication).toEqual({ decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" });
  });

  it("refuses to issue from an open profile proposal", () => {
    const observed = observeSealedExpectedFrontierV1({
      expected: { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1",
    });
    expect(admitOpenProfileFrontierV1({ storedAction: "PROPOSE", observed })).toEqual({
      decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT", allowanceId: null, orderId: null,
      exposureDelta: "2", pendingDelta: "-1",
    });
    expect(admitOpenProfileFrontierV1({
      storedAction: "PROPOSE", observed: { ...observed, publication: { decision: "PUBLISHED", reason: "OK" } },
    })).toEqual({
      decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT", allowanceId: null, orderId: null,
      exposureDelta: "2", pendingDelta: "-1",
    });
    expect(() => admitOpenProfileFrontierV1({ storedAction: "CANCEL", observed })).toThrow(RiskCurrentAccountRefusedV1);
    const suffix = {
      predecessorHeadDigest: null, predecessorNextEventSequence: "1", predecessorNextAdmissionSequence: "1",
      predecessorReconciledExposureNotional: "0", predecessorPendingExposureNotional: "0", predecessorReservationNotional: "0",
      openedAllowances: [], closedAllowances: [], alreadyDisposedTruthIds: [], events: [],
      terminalHeadDigest: null, terminalNextEventSequence: "1", terminalNextAdmissionSequence: "1",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
      terminalOpenAllowances: [], terminalConsumedAllowances: [],
      organizationId: org, accountId: "synthetic-spot",
      predecessorStateVersion: "1", terminalStateVersion: "1",
      declaredMaxEvents: 4,
    };
    const account = { organizationId: org, accountId: "synthetic-spot" };
    expect(admitFoldedSuffixV1({ storedAction: "PROPOSE", observed, account, unpublishedTruthRecordIds: [], suffix })).toMatchObject({
      decision: "REFUSED", allowanceId: null, orderId: null,
    });
    expect(() => admitFoldedSuffixV1({
      storedAction: "PROPOSE", observed, account, unpublishedTruthRecordIds: [], suffix: { ...suffix, terminalReconciledExposureNotional: "1" },
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => admitFoldedSuffixV1({
      storedAction: "PROPOSE", observed, account: { ...account, accountId: "other-account" }, unpublishedTruthRecordIds: [], suffix,
    })).toThrow(RiskCurrentAccountRefusedV1);
  });
  it("authenticates a gap-free Expected event suffix and refuses a gap or an undeclared length", () => {
    const head = digest("suffix-event");
    expect(authenticateExpectedEventSuffixV1({
      predecessorHeadDigest: null, predecessorNextEventSequence: "1", events: [],
      terminalHeadDigest: null, terminalNextEventSequence: "1", declaredMaxEvents: 4, predecessorReconciledExposureNotional: "0", predecessorPendingExposureNotional: "0", predecessorReservationNotional: "0", terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
    })).toEqual({ decision: "AUTHENTICATED", eventCount: 0, notionalsVerified: true, currentPointer: null });
    expect(authenticateExpectedEventSuffixV1({
      predecessorHeadDigest: null, predecessorNextEventSequence: "1",
      events: [{ sequence: "1", previousDigest: null, contentDigest: head }],
      terminalHeadDigest: head, terminalNextEventSequence: "2", declaredMaxEvents: 4, predecessorReconciledExposureNotional: "0", predecessorPendingExposureNotional: "0", predecessorReservationNotional: "0", terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
    }).eventCount).toBe(1);
    expect(() => authenticateExpectedEventSuffixV1({
      predecessorHeadDigest: null, predecessorNextEventSequence: "1",
      events: [{ sequence: "2", previousDigest: null, contentDigest: head }],
      terminalHeadDigest: head, terminalNextEventSequence: "3", declaredMaxEvents: 4, predecessorReconciledExposureNotional: "0", predecessorPendingExposureNotional: "0", predecessorReservationNotional: "0", terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => authenticateExpectedEventSuffixV1({
      predecessorHeadDigest: null, predecessorNextEventSequence: "1", events: [],
      terminalHeadDigest: null, terminalNextEventSequence: "1", declaredMaxEvents: 0, predecessorReconciledExposureNotional: "0", predecessorPendingExposureNotional: "0", predecessorReservationNotional: "0", terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => authenticateExpectedEventSuffixV1({
      predecessorHeadDigest: null, predecessorNextEventSequence: "1", events: [],
      terminalHeadDigest: null, terminalNextEventSequence: "1", declaredMaxEvents: 4, predecessorReconciledExposureNotional: "0", predecessorPendingExposureNotional: "0", predecessorReservationNotional: "0", terminalReconciledExposureNotional: "1", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
  });

  it("folds issued then consumed enforcement into pending and refuses a stale reservation", () => {
    const head = digest("fold-event");
    const base = {
      predecessorHeadDigest: null, predecessorNextEventSequence: "1", predecessorNextAdmissionSequence: "1",
      predecessorReconciledExposureNotional: "0", predecessorPendingExposureNotional: "0", predecessorReservationNotional: "0",
      openedAllowances: [], closedAllowances: [], alreadyDisposedTruthIds: [], terminalOpenAllowances: [], terminalConsumedAllowances: [],
      organizationId: org, accountId: "synthetic-spot",
      predecessorStateVersion: "1", terminalStateVersion: "1",
      declaredMaxEvents: 4,
    };
    const issued = { sequence: "1", previousDigest: null, contentDigest: head, type: "ALLOWANCE_ISSUED" as const, organizationId: org, accountId: "synthetic-spot", fromState: null, toState: "ISSUED" as const, allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-1", boundOrderId: null, boundOrderDigestHex: null };
    expect(foldExpectedEnforcementSuffixV1({
      ...base, events: [issued],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
      terminalOpenAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalStateVersion: "2",
    })).toEqual({ decision: "AUTHENTICATED", eventCount: 1, notionalsVerified: true, heldTruthRecordIds: [], currentPointer: null });
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [{ ...issued, accountId: "other-account" }],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
      terminalOpenAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalStateVersion: "2",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [{ ...issued, boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
      terminalOpenAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalStateVersion: "2",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [{ ...issued, toState: "CONSUMED" }],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
      terminalOpenAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalStateVersion: "2",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [issued],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
      terminalOpenAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
    })).toThrow(RiskCurrentAccountRefusedV1);
    const consumedHead = digest("fold-consumed");
    expect(foldExpectedEnforcementSuffixV1({
      ...base, events: [issued, { sequence: "2", previousDigest: head, contentDigest: consumedHead, type: "ALLOWANCE_CONSUMED", organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED", toState: "CONSUMED", allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalHeadDigest: consumedHead, terminalNextEventSequence: "3", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
      terminalConsumedAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalStateVersion: "3",
    }).eventCount).toBe(2);
    const renewHead = digest("fold-renew");
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [issued, { sequence: "2", previousDigest: head, contentDigest: consumedHead, type: "ALLOWANCE_CONSUMED", organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED", toState: "CONSUMED", allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1" },
        { sequence: "3", previousDigest: consumedHead, contentDigest: renewHead, type: "ALLOWANCE_ISSUED", organizationId: org, accountId: "synthetic-spot", fromState: null, toState: "ISSUED", allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-1", boundOrderId: null, boundOrderDigestHex: null }],
      terminalHeadDigest: renewHead, terminalNextEventSequence: "4", terminalNextAdmissionSequence: "3",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "10",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [issued],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    const priorHead = digest("fold-prior-consume");
    expect(foldExpectedEnforcementSuffixV1({
      ...base, predecessorReservationNotional: "10",
      openedAllowances: [{ allowanceId: "allow-prior", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-prior" }],
      predecessorHeadDigest: null, predecessorNextEventSequence: "1",
      events: [{ sequence: "1", previousDigest: null, contentDigest: priorHead, type: "ALLOWANCE_CONSUMED", organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED", toState: "CONSUMED", allowanceId: "allow-prior", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-prior", boundOrderId: "order-allow-prior", boundOrderDigestHex: digest("order-allow-prior") }],
      terminalHeadDigest: priorHead, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "1",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
      terminalConsumedAllowances: [{ allowanceId: "allow-prior", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-prior", boundOrderDigestHex: digest("order-allow-prior") }],
      terminalStateVersion: "2",
    }).eventCount).toBe(1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, closedAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "0", quantity: "1", disposition: "RELEASED", boundOrderId: null, boundOrderDigestHex: null }],
      events: [issued],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(foldExpectedEnforcementSuffixV1({
      ...base, predecessorPendingExposureNotional: "10",
      closedAllowances: [{ allowanceId: "allow-old", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-old", boundOrderDigestHex: digest("order-allow-old"), disposition: "CONSUMED" }],
      events: [],
      terminalHeadDigest: null, terminalNextEventSequence: "1", terminalNextAdmissionSequence: "1",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
      terminalConsumedAllowances: [{ allowanceId: "allow-old", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-old", boundOrderDigestHex: digest("order-allow-old") }],
    }).eventCount).toBe(0);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, predecessorPendingExposureNotional: "10",
      events: [],
      terminalHeadDigest: null, terminalNextEventSequence: "1", terminalNextAdmissionSequence: "1",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    const priorTruth = digest("prior-inclusion");
    const reuseHead = digest("fold-reuse");
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, predecessorReservationNotional: "10", predecessorPendingExposureNotional: "10",
      openedAllowances: [{ allowanceId: "allow-2", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-2" }],
      closedAllowances: [{ allowanceId: "allow-old", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-old", boundOrderDigestHex: digest("order-allow-old"), disposition: "CONSUMED", truthRecordId: priorTruth }],
      events: [{ sequence: "1", previousDigest: null, contentDigest: reuseHead, type: "ALLOWANCE_CONSUMED", organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED", toState: "CONSUMED", allowanceId: "allow-2", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-2", boundOrderId: "order-allow-2", boundOrderDigestHex: digest("order-allow-2"), truthRecordId: priorTruth }],
      terminalHeadDigest: reuseHead, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "1",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "20", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    const refusedHead = digest("fold-refused");
    expect(foldExpectedEnforcementSuffixV1({
      ...base, events: [issued, { sequence: "2", previousDigest: head, contentDigest: refusedHead, type: "CONSUMPTION_REFUSED", organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED", toState: "REVOKED", allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-1", boundOrderId: null, boundOrderDigestHex: null }],
      terminalHeadDigest: refusedHead, terminalNextEventSequence: "3", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "0",
      terminalStateVersion: "3",
    }).eventCount).toBe(2);
    const inclusion = digest("suffix-inclusion");
    const includedHead = digest("fold-included");
    const included = [issued, { sequence: "2", previousDigest: head, contentDigest: includedHead, type: "ALLOWANCE_CONSUMED" as const, organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED" as const, toState: "CONSUMED" as const, allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1"), truthRecordId: inclusion }];
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [{ ...issued, truthRecordId: inclusion }],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(foldExpectedEnforcementSuffixV1({
      ...base, events: included,
      terminalHeadDigest: includedHead, terminalNextEventSequence: "3", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
      terminalConsumedAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalStateVersion: "3",
    }).heldTruthRecordIds).toEqual([inclusion]);
    const includedSuffix = { ...base, events: included, terminalHeadDigest: includedHead, terminalNextEventSequence: "3",
      terminalNextAdmissionSequence: "2", terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
      terminalConsumedAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-1", boundOrderDigestHex: digest("order-allow-1") }],
      terminalStateVersion: "3" };
    const account = { organizationId: org, accountId: "synthetic-spot" };
    const observed = observeSealedExpectedFrontierV1({
      expected: { ...initialExpected(), reconciledExposureNotional: "10", pendingExposureNotional: "1" },
      actualExposureNotional: "12", actualPendingNotional: "0", sourceMethodQualified: false, externalDebtNotional: "1" });
    expect(admitFoldedSuffixV1({ storedAction: "PROPOSE", observed, account, unpublishedTruthRecordIds: [inclusion], suffix: includedSuffix })).toMatchObject({
      decision: "REFUSED", allowanceId: null, orderId: null });
    expect(() => admitFoldedSuffixV1({ storedAction: "PROPOSE", observed, account, unpublishedTruthRecordIds: [], suffix: includedSuffix })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, alreadyDisposedTruthIds: [inclusion], events: included,
      terminalHeadDigest: includedHead, terminalNextEventSequence: "3", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [issued, { sequence: "2", previousDigest: head, contentDigest: consumedHead, type: "ALLOWANCE_CONSUMED", organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED", toState: "CONSUMED", allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "2" }],
      terminalHeadDigest: consumedHead, terminalNextEventSequence: "3", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [{ ...issued, quantity: "0" }],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
      terminalOpenAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "0" }],
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, events: [issued],
      terminalHeadDigest: head, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "2",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "0", terminalReservationNotional: "10",
      terminalOpenAllowances: [{ allowanceId: "allow-1", reservedExposureNotional: "10", quantity: "2" }],
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, predecessorPendingExposureNotional: "10",
      closedAllowances: [{ allowanceId: "allow-old", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-old", boundOrderDigestHex: digest("order-allow-old"), disposition: "CONSUMED" }],
      events: [],
      terminalHeadDigest: null, terminalNextEventSequence: "1", terminalNextAdmissionSequence: "1",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "10", terminalReservationNotional: "0",
      terminalConsumedAllowances: [{ allowanceId: "allow-old", reservedExposureNotional: "10", quantity: "2", boundOrderId: "order-allow-old", boundOrderDigestHex: digest("order-allow-old") }],
    })).toThrow(RiskCurrentAccountRefusedV1);
    expect(() => foldExpectedEnforcementSuffixV1({
      ...base, predecessorReservationNotional: "10", predecessorPendingExposureNotional: "10",
      openedAllowances: [{ allowanceId: "allow-prior", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-prior" }],
      closedAllowances: [{ allowanceId: "allow-old", reservedExposureNotional: "10", quantity: "1", boundOrderId: "order-allow-prior", boundOrderDigestHex: digest("order-allow-prior"), disposition: "CONSUMED" }],
      events: [{ sequence: "1", previousDigest: null, contentDigest: priorHead, type: "ALLOWANCE_CONSUMED", organizationId: org, accountId: "synthetic-spot", fromState: "ISSUED", toState: "CONSUMED", allowanceId: "allow-prior", reservedExposureNotional: "10", quantity: "1", riskVerdictId: "verdict-allow-prior", boundOrderId: "order-allow-prior", boundOrderDigestHex: digest("order-allow-prior") }],
      terminalHeadDigest: priorHead, terminalNextEventSequence: "2", terminalNextAdmissionSequence: "1",
      terminalReconciledExposureNotional: "0", terminalPendingExposureNotional: "20", terminalReservationNotional: "0",
      terminalStateVersion: "2",
    })).toThrow(RiskCurrentAccountRefusedV1);
  });

});
