import { formatDecimal, parseDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import {
  validateRealityProjectionV2,
  type RealityProjectionV2,
} from "@/lib/trader/reality/v2/contracts";
import {
  assertRiskAccountRecordSealV1,
  exactRiskAccountNotionalV1,
  parseRiskAccountProfileV1,
  RiskCurrentAccountRefusedV1,
  riskAccountDecimalSchemaV1,
  riskAccountDigestSchemaV1,
  riskAccountTimeSchemaV1,
  sealRiskAccountRecordV1,
  type RiskAccountProfileV1,
  type RiskAccountReferenceV1,
  type SealedRiskAccountRecordV1,
} from "./risk-account-source-profile-v1";

export type RiskAccountObligationV1 = Readonly<{
  allowanceId: string;
  allowanceContentDigest: string;
  verdictId: string;
  verdictContentDigest: string;
  instrumentIdentityDigest: string;
  symbol: string;
  baseAsset: string;
  side: "BUY" | "SELL";
  quantity: string;
  reservedNotional: string;
  pendingNotional: string;
  state: "ISSUED" | "CONSUMED";
  orderId: string | null;
  orderBindingDigest: string | null;
}>;

export type RiskExpectedFrontierV1 = Readonly<{
  stateVersion: string;
  nextAdmissionSequence: string;
  nextEventSequence: string;
  eventHeadDigest: string | null;
  reconciledExposureNotional: string;
  pendingExposureNotional: string;
  reservationNotional: string;
  obligations: readonly RiskAccountObligationV1[];
}>;

export type RiskIndependentInclusionV1 = Readonly<{
  allowanceId: string;
  orderId: string;
  orderBindingDigest: string;
  truthRecordId: string;
  sourceReportId: string;
  sourceContentDigest: string;
  venueTradeId: string;
  venueOrderId: string;
  symbol: string;
  baseAsset: string;
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  feeAmount: string;
  feeAsset: string;
  validAtUtc: string;
  knowledgeAtUtc: string;
}>;

export type RiskAccountBasisV1 = SealedRiskAccountRecordV1<{
  schemaVersion: "risk-account-basis/v1";
  organizationId: string;
  accountId: string;
  profileDigest: string;
  referenceDigest: string;
  acquisitionDigest: string;
  predecessorBasisDigest: string | null;
  publishedAtUtc: string;
  validUntilUtc: string;
  reality: {
    snapshotId: string;
    contentDigest: string;
    knowledgeAsOfUtc: string;
    validAtUtc: string;
    frontierSequence: string;
    frontierDigest: string | null;
  };
  comparison: "INITIAL_INDEPENDENT_ANCHOR" | "EXACT_EXPECTED_MATCH";
  assets: readonly {
    asset: string;
    anchorQuantity: string;
    upperQuantity: string;
    guaranteedLowerQuantity: string;
    referencePrice: string;
    positiveDebtQuantity: string;
    negativeDebtQuantity: string;
  }[];
  accounting: {
    reconciledExposureNotional: string;
    worstCasePendingExposureNotional: string;
    outstandingReservationNotional: string;
    exposureLimitNotional: string;
  };
  externalDebtNotional: string;
  expected: RiskExpectedFrontierV1;
  inclusionDispositions: readonly RiskIndependentInclusionV1[];
}>;

function refuse(reason: string): never {
  throw new RiskCurrentAccountRefusedV1(reason);
}
const nonnegative = (value: string) => parseDecimal(riskAccountDecimalSchemaV1.parse(value));
const sequence = (value: string) => {
  if (!/^[1-9]\d{0,39}$/.test(value)) refuse("EXPECTED_SEQUENCE");
  return BigInt(value);
};

/** A pure value constructor, never a persisted-source or permission issuer. */
export function constructRiskAccountBasisV1(input: {
  profile: RiskAccountProfileV1;
  reference: RiskAccountReferenceV1;
  acquisitionDigest: string;
  reality: RealityProjectionV2;
  publishedAtUtc: string;
  expected: RiskExpectedFrontierV1;
  predecessor: RiskAccountBasisV1 | null;
  inclusions: readonly RiskIndependentInclusionV1[];
  alreadyDisposedTruthIds: readonly string[];
}): RiskAccountBasisV1 {
  const profile = parseRiskAccountProfileV1(input.profile),
    reference = assertRiskAccountRecordSealV1(input.reference);
  const now = Date.parse(riskAccountTimeSchemaV1.parse(input.publishedAtUtc));
  riskAccountDigestSchemaV1.parse(input.acquisitionDigest);
  if (
    reference.schemaVersion !== "risk-account-reference/v1" ||
    reference.profileDigest !== profile.contentDigest ||
    reference.organizationId !== profile.organizationId ||
    reference.accountId !== profile.accountId ||
    now < Date.parse(reference.assembledAtUtc) ||
    now >= Date.parse(reference.validUntilUtc)
  )
    refuse("REFERENCE_CURRENTNESS");
  const projection = input.reality;
  if (
    !validateRealityProjectionV2(projection) ||
    projection.organizationId !== profile.organizationId ||
    projection.accountId !== profile.accountId ||
    projection.uncertainties.length > 0 ||
    Date.parse(projection.knowledgeAsOfUtc) > now
  )
    refuse("INDEPENDENT_ANCHOR_UNAVAILABLE");
  const accounts = projection.stableEntries.filter(
    (entry) => entry.primitiveAssertion.kind === "ACCOUNT",
  );
  if (
    accounts.length !== 1 ||
    accounts[0]!.primitiveAssertion.kind !== "ACCOUNT" ||
    accounts[0]!.primitiveAssertion.venueAccountId !== profile.exchangeAccountId ||
    accounts[0]!.primitiveAssertion.accountType !== "SPOT" ||
    accounts[0]!.primitiveAssertion.accountState !== "working"
  )
    refuse("ANCHOR_ACCOUNT_CLASS");
  const balances = projection.stableEntries.filter(
    (entry) => entry.primitiveAssertion.kind === "BALANCE",
  );
  if (balances.length !== profile.assets.length) refuse("ANCHOR_ASSET_UNIVERSE");
  const anchorTime = accounts[0]!.validAtUtc;
  const anchorMs = Date.parse(riskAccountTimeSchemaV1.parse(anchorTime));
  if (
    anchorMs > now ||
    now - anchorMs > profile.sourceContract.maxSourceAgeMs ||
    anchorMs < Date.parse(profile.sourceContract.validFromUtc) ||
    now >= Date.parse(profile.sourceContract.validUntilUtc) ||
    now < Date.parse(profile.allocation.validFromUtc) ||
    now >= Date.parse(profile.allocation.validUntilUtc)
  )
    refuse("ANCHOR_OR_PROFILE_EXPIRED");
  const quantities = new Map<string, bigint>();
  for (const entry of balances) {
    if (entry.primitiveAssertion.kind !== "BALANCE") refuse("ANCHOR_BALANCE");
    const row = entry.primitiveAssertion;
    if (
      quantities.has(row.asset) ||
      !profile.assets.includes(row.asset) ||
      entry.validAtUtc !== anchorTime ||
      Date.parse(entry.knowledgeAtUtc) > Date.parse(projection.knowledgeAsOfUtc) ||
      nonnegative(row.available) + nonnegative(row.locked) !== nonnegative(row.total)
    )
      refuse("ANCHOR_BALANCE");
    quantities.set(row.asset, nonnegative(row.total));
  }
  const expected = input.expected;
  sequence(expected.stateVersion);
  sequence(expected.nextAdmissionSequence);
  sequence(expected.nextEventSequence);
  if (expected.eventHeadDigest !== null) riskAccountDigestSchemaV1.parse(expected.eventHeadDigest);
  const allowanceIds = new Set<string>(),
    orderIds = new Set<string>();
  let reservations = 0n,
    pending = 0n;
  for (const obligation of expected.obligations) {
    if (
      !["BUY", "SELL"].includes(obligation.side) ||
      allowanceIds.has(obligation.allowanceId) ||
      !profile.instruments.some(
        (i) =>
          i.instrumentIdentityDigestHex === obligation.instrumentIdentityDigest &&
          i.symbol === obligation.symbol &&
          i.baseAsset === obligation.baseAsset,
      ) ||
      nonnegative(obligation.quantity) === 0n
    )
      refuse("EXPECTED_OBLIGATION_IDENTITY");
    allowanceIds.add(obligation.allowanceId);
    for (const digest of [obligation.allowanceContentDigest, obligation.verdictContentDigest])
      riskAccountDigestSchemaV1.parse(digest);
    if (obligation.state === "ISSUED") {
      if (
        obligation.orderId !== null ||
        obligation.orderBindingDigest !== null ||
        nonnegative(obligation.pendingNotional) !== 0n
      )
        refuse("EXPECTED_ISSUED_STATE");
      reservations += nonnegative(obligation.reservedNotional);
    } else if (obligation.state === "CONSUMED") {
      if (!obligation.orderId || !obligation.orderBindingDigest || orderIds.has(obligation.orderId))
        refuse("EXPECTED_CONSUMED_STATE");
      riskAccountDigestSchemaV1.parse(obligation.orderBindingDigest);
      orderIds.add(obligation.orderId);
      pending += nonnegative(obligation.pendingNotional);
    } else refuse("EXPECTED_STATE");
    if (
      obligation.side === "SELL" &&
      (nonnegative(obligation.reservedNotional) !== 0n ||
        nonnegative(obligation.pendingNotional) !== 0n)
    )
      refuse("REDUCTION_ACCOUNTING");
  }
  if (reservations !== nonnegative(expected.reservationNotional))
    refuse("EXPECTED_RESERVATION_SUM");
  const prior = input.predecessor;
  if (prior) {
    assertRiskAccountRecordSealV1(prior);
    if (
      prior.organizationId !== profile.organizationId ||
      prior.accountId !== profile.accountId ||
      Date.parse(prior.reality.validAtUtc) > anchorMs ||
      prior.assets.map((row) => row.asset).join("|") !== profile.assets.join("|") ||
      BigInt(expected.stateVersion) < BigInt(prior.expected.stateVersion) ||
      BigInt(expected.nextEventSequence) < BigInt(prior.expected.nextEventSequence) ||
      BigInt(expected.nextAdmissionSequence) < BigInt(prior.expected.nextAdmissionSequence) ||
      expected.reconciledExposureNotional !== prior.accounting.reconciledExposureNotional
    )
      refuse("PREDECESSOR_SCOPE_OR_TIME");
    if (
      nonnegative(expected.pendingExposureNotional) !==
      pending + nonnegative(prior.externalDebtNotional)
    )
      refuse("EXPECTED_PENDING_SUM");
  } else if (
    expected.obligations.length ||
    expected.eventHeadDigest !== null ||
    expected.nextAdmissionSequence !== "1" ||
    expected.nextEventSequence !== "1" ||
    expected.stateVersion !== "1" ||
    nonnegative(expected.reconciledExposureNotional) !== 0n ||
    nonnegative(expected.pendingExposureNotional) !== 0n ||
    nonnegative(expected.reservationNotional) !== 0n
  )
    refuse("UNPROVED_INITIAL_EXPECTED");

  const disposed = new Set(input.alreadyDisposedTruthIds),
    includedAllowances = new Set<string>();
  const expectedQuantities = prior
    ? new Map(prior.assets.map((row) => [row.asset, nonnegative(row.anchorQuantity)]))
    : new Map(quantities);
  let releasedPending = 0n;
  for (const fact of input.inclusions) {
    const obligation = expected.obligations.find((row) => row.allowanceId === fact.allowanceId);
    const entry = projection.stableEntries.find((row) => row.truthRecordId === fact.truthRecordId);
    if (
      !prior ||
      disposed.has(fact.truthRecordId) ||
      includedAllowances.has(fact.allowanceId) ||
      !obligation ||
      obligation.state !== "CONSUMED" ||
      obligation.orderId !== fact.orderId ||
      obligation.orderBindingDigest !== fact.orderBindingDigest ||
      obligation.symbol !== fact.symbol ||
      obligation.baseAsset !== fact.baseAsset ||
      obligation.side !== fact.side ||
      obligation.quantity !== fact.quantity ||
      !entry ||
      entry.sourceReportId !== fact.sourceReportId ||
      entry.primitiveAssertion.kind !== "FILL" ||
      entry.validAtUtc !== fact.validAtUtc ||
      entry.knowledgeAtUtc !== fact.knowledgeAtUtc ||
      Date.parse(fact.validAtUtc) <= Date.parse(prior.reality.validAtUtc) ||
      Date.parse(fact.validAtUtc) > anchorMs ||
      !profile.assets.includes(fact.feeAsset)
    )
      refuse("INDEPENDENT_INCLUSION_IDENTITY");
    const actual = entry.primitiveAssertion;
    if (
      actual.settlementStatus !== "SETTLED" ||
      actual.venueTradeId !== fact.venueTradeId ||
      actual.venueOrderId !== fact.venueOrderId ||
      actual.symbol !== fact.symbol ||
      actual.side.toUpperCase() !== fact.side ||
      actual.quantity !== fact.quantity ||
      actual.price !== fact.price ||
      actual.feeAmount !== fact.feeAmount ||
      actual.feeAsset !== fact.feeAsset
    )
      refuse("INDEPENDENT_INCLUSION_CONTENT");
    riskAccountDigestSchemaV1.parse(fact.sourceContentDigest);
    const quantity = nonnegative(fact.quantity),
      quote = parseDecimal(exactRiskAccountNotionalV1(fact.quantity, fact.price));
    const direction = fact.side === "BUY" ? 1n : -1n;
    expectedQuantities.set(
      fact.baseAsset,
      (expectedQuantities.get(fact.baseAsset) ?? 0n) + direction * quantity,
    );
    expectedQuantities.set("USDT", (expectedQuantities.get("USDT") ?? 0n) - direction * quote);
    expectedQuantities.set(
      fact.feeAsset,
      (expectedQuantities.get(fact.feeAsset) ?? 0n) - nonnegative(fact.feeAmount),
    );
    disposed.add(fact.truthRecordId);
    includedAllowances.add(fact.allowanceId);
    releasedPending += nonnegative(obligation.pendingNotional);
  }
  if (profile.assets.some((asset) => expectedQuantities.get(asset) !== quantities.get(asset)))
    refuse("STANDING_DIVERGENCE");
  let expiry = Math.min(
    Date.parse(reference.validUntilUtc),
    Date.parse(profile.sourceContract.validUntilUtc),
    Date.parse(profile.allocation.validUntilUtc),
    anchorMs + profile.sourceContract.maxSourceAgeMs,
  );
  for (const bound of profile.mutationBounds) {
    if (Date.parse(bound.intervalStartUtc) > anchorMs) refuse("MUTATION_WINDOW_GAP");
    expiry = Math.min(expiry, Date.parse(bound.intervalEndUtc));
  }
  if (!Number.isSafeInteger(expiry) || expiry <= now) refuse("BASIS_EXPIRED");
  let exposure = 0n,
    externalDebt = 0n;
  const assets = profile.assets.map((asset) => {
    const q = quantities.get(asset)!;
    const bounds = profile.mutationBounds.filter((row) => row.asset === asset);
    const positive = bounds.reduce(
      (sum, row) => sum + nonnegative(row.maximumPositiveQuantity),
      0n,
    );
    const negative = bounds.reduce(
      (sum, row) => sum + nonnegative(row.maximumNegativeQuantity),
      0n,
    );
    const price =
      asset === "USDT" ? "1" : reference.prices.find((row) => row.asset === asset)?.price;
    if (!price) return refuse("REFERENCE_ASSET_MISSING");
    // Quote cash is inventory/funding, not a long position. Every nonquote asset is charged.
    if (asset !== "USDT") {
      exposure += parseDecimal(exactRiskAccountNotionalV1(formatDecimal(q), price));
      externalDebt += parseDecimal(exactRiskAccountNotionalV1(formatDecimal(positive), price));
    }
    return {
      asset,
      anchorQuantity: formatDecimal(q),
      upperQuantity: formatDecimal(q + positive),
      guaranteedLowerQuantity: formatDecimal(q > negative ? q - negative : 0n),
      referencePrice: price,
      positiveDebtQuantity: formatDecimal(positive),
      negativeDebtQuantity: formatDecimal(negative),
    };
  });
  const retainedObligations = expected.obligations.filter(
    (row) => !includedAllowances.has(row.allowanceId),
  );
  // Old charges may be discharged through exact independent inclusion in this same publication.
  // A changed reference cannot silently revalue/re-admit any obligation which remains outstanding.
  if (
    prior &&
    prior.referenceDigest !== reference.contentDigest &&
    retainedObligations.length !== 0
  )
    refuse("REFERENCE_DRIFT_WITH_OBLIGATIONS");
  const nextPending = pending - releasedPending + externalDebt;
  const accounting = {
    reconciledExposureNotional: formatDecimal(exposure),
    worstCasePendingExposureNotional: formatDecimal(nextPending),
    outstandingReservationNotional: formatDecimal(reservations),
    exposureLimitNotional: profile.allocation.approvedNotional,
  };
  return sealRiskAccountRecordV1({
    schemaVersion: "risk-account-basis/v1" as const,
    organizationId: profile.organizationId,
    accountId: profile.accountId,
    profileDigest: profile.contentDigest,
    referenceDigest: reference.contentDigest,
    acquisitionDigest: input.acquisitionDigest,
    predecessorBasisDigest: prior?.contentDigest ?? null,
    publishedAtUtc: input.publishedAtUtc,
    validUntilUtc: new Date(expiry).toISOString(),
    reality: {
      snapshotId: projection.projectionId,
      contentDigest: projection.contentDigestHex,
      knowledgeAsOfUtc: projection.knowledgeAsOfUtc,
      validAtUtc: anchorTime,
      frontierSequence: projection.frontierSequence,
      frontierDigest: projection.frontierEventDigestHex,
    },
    comparison: prior ? ("EXACT_EXPECTED_MATCH" as const) : ("INITIAL_INDEPENDENT_ANCHOR" as const),
    assets,
    accounting,
    externalDebtNotional: formatDecimal(externalDebt),
    expected: {
      ...expected,
      reconciledExposureNotional: accounting.reconciledExposureNotional,
      pendingExposureNotional: accounting.worstCasePendingExposureNotional,
      obligations: retainedObligations,
    },
    inclusionDispositions: [...input.inclusions],
  });
}

/** Exact identity exception only: its own already counted obligation is not charged twice. */
export function availableRiskAccountQuantityV1(input: {
  basis: RiskAccountBasisV1;
  asset: string;
  obligations: readonly RiskAccountObligationV1[];
  own?: {
    allowanceId: string;
    allowanceContentDigest: string;
    orderId: string | null;
    quantity: string;
  };
}): string {
  assertRiskAccountRecordSealV1(input.basis);
  const asset = input.basis.assets.find((row) => row.asset === input.asset);
  if (!asset) return refuse("INVENTORY_ASSET_MISSING");
  let lower = nonnegative(asset.guaranteedLowerQuantity),
    ownMatched = false;
  const seen = new Set<string>();
  for (const obligation of input.obligations) {
    if (seen.has(obligation.allowanceId)) refuse("DUPLICATE_OBLIGATION");
    seen.add(obligation.allowanceId);
    if (obligation.side !== "SELL" || obligation.baseAsset !== input.asset) continue;
    if (input.own && obligation.allowanceId === input.own.allowanceId) {
      if (
        obligation.allowanceContentDigest !== input.own.allowanceContentDigest ||
        obligation.orderId !== input.own.orderId ||
        obligation.quantity !== input.own.quantity
      )
        refuse("OWN_OBLIGATION_MISMATCH");
      ownMatched = true;
    } else lower -= nonnegative(obligation.quantity);
  }
  if (input.own && !ownMatched) refuse("OWN_OBLIGATION_MISSING");
  return formatDecimal(lower > 0n ? lower : 0n);
}

/** Publication stays closed until a real LiveCapitalEnvelopeV2 producer exists.
 *  A qualified method flag, profile allocation, or caller digest cannot approve. */
export function decideCurrentAccountBasisPublicationV1(input: {
  liveCapitalEnvelope: null;
  sourceMethodQualified: boolean;
}): { decision: "REFUSED"; reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" } {
  void input.liveCapitalEnvelope;
  void input.sourceMethodQualified;
  return { decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" };
}

/** Observed Expected versus Actual notionals. The delta is not a limit and cannot publish. */
export function compareExpectedAccountFrontierV1(input: {
  expectedExposureNotional: string;
  expectedPendingNotional: string;
  actualExposureNotional: string;
  actualPendingNotional: string;
  sourceMethodQualified: boolean;
}): {
  decision: "OBSERVED";
  publication: { decision: "REFUSED"; reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" };
  exposureDelta: string;
  pendingDelta: string;
} {
  return {
    decision: "OBSERVED",
    publication: decideCurrentAccountBasisPublicationV1({
      liveCapitalEnvelope: null,
      sourceMethodQualified: input.sourceMethodQualified,
    }),
    exposureDelta: subtractDecimal(input.actualExposureNotional, input.expectedExposureNotional),
    pendingDelta: subtractDecimal(input.actualPendingNotional, input.expectedPendingNotional),
  };
}

/** An observed delta is retained in memory only. It does not write a basis or the current pointer. */
export function retainObservedFrontierV1(
  comparison: ReturnType<typeof compareExpectedAccountFrontierV1>,
): { currentPointer: null; basisWrite: null; retention: "DELTA_ONLY" } {
  if (comparison.publication.reason !== "LIVE_CAPITAL_ENVELOPE_ABSENT") {
    throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
  }
  return { currentPointer: null, basisWrite: null, retention: "DELTA_ONLY" };
}

/** The only current-account issue entry. It cannot mint an allowance while publication is refused. */
export function admitCurrentAccountBasisV1(
  retained: ReturnType<typeof retainObservedFrontierV1>,
): { decision: "REFUSED"; reason: "LIVE_CAPITAL_ENVELOPE_ABSENT"; allowanceId: null; orderId: null } {
  if (retained.currentPointer !== null || retained.basisWrite !== null) {
    throw new RiskCurrentAccountRefusedV1("LIVE_CAPITAL_ENVELOPE_ABSENT");
  }
  return { decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT", allowanceId: null, orderId: null };
}

/** Validates the sealed Expected frontier, then observes Actual. The delta still cannot publish. */
export function observeSealedExpectedFrontierV1(input: {
  expected: RiskExpectedFrontierV1;
  actualExposureNotional: string;
  actualPendingNotional: string;
  sourceMethodQualified: boolean;
}): ReturnType<typeof compareExpectedAccountFrontierV1> {
  const expected = input.expected;
  sequence(expected.stateVersion);
  sequence(expected.nextAdmissionSequence);
  sequence(expected.nextEventSequence);
  if (expected.eventHeadDigest !== null) riskAccountDigestSchemaV1.parse(expected.eventHeadDigest);
  const allowanceIds = new Set<string>();
  let reservations = 0n;
  for (const obligation of expected.obligations) {
    if (allowanceIds.has(obligation.allowanceId) || !["BUY", "SELL"].includes(obligation.side))
      refuse("EXPECTED_OBLIGATION_IDENTITY");
    allowanceIds.add(obligation.allowanceId);
    if (obligation.state === "ISSUED") {
      if (obligation.orderId !== null || obligation.orderBindingDigest !== null || nonnegative(obligation.pendingNotional) !== 0n)
        refuse("EXPECTED_ISSUED_STATE");
      reservations += nonnegative(obligation.reservedNotional);
    } else if (obligation.state === "CONSUMED") {
      if (!obligation.orderId || !obligation.orderBindingDigest) refuse("EXPECTED_CONSUMED_STATE");
    } else refuse("EXPECTED_STATE");
    if (obligation.side === "SELL" && (nonnegative(obligation.reservedNotional) !== 0n || nonnegative(obligation.pendingNotional) !== 0n))
      refuse("REDUCTION_ACCOUNTING");
  }
  if (reservations !== nonnegative(expected.reservationNotional)) refuse("EXPECTED_RESERVATION_SUM");
  nonnegative(expected.reconciledExposureNotional);
  nonnegative(expected.pendingExposureNotional);
  return compareExpectedAccountFrontierV1({
    expectedExposureNotional: expected.reconciledExposureNotional,
    expectedPendingNotional: expected.pendingExposureNotional,
    actualExposureNotional: input.actualExposureNotional,
    actualPendingNotional: input.actualPendingNotional,
    sourceMethodQualified: input.sourceMethodQualified,
  });
}
