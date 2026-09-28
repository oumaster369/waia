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

/** Exact identity exception only: its own already counted obligation is not charged twice.
 *  Obligations come from the sealed basis. A caller cannot omit a sibling reduction. */
export function availableRiskAccountQuantityV1(input: {
  basis: RiskAccountBasisV1;
  asset: string;
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
  for (const obligation of input.basis.expected.obligations) {
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

function sumExpectedObligationsV1(obligations: readonly RiskAccountObligationV1[]): { reservations: bigint; consumedPending: bigint } {
  const allowanceIds = new Set<string>();
  const orderIds = new Set<string>();
  let reservations = 0n, consumedPending = 0n;
  for (const obligation of obligations) {
    if (allowanceIds.has(obligation.allowanceId) || !["BUY", "SELL"].includes(obligation.side))
      refuse("EXPECTED_OBLIGATION_IDENTITY");
    allowanceIds.add(obligation.allowanceId);
    for (const value of [obligation.allowanceContentDigest, obligation.verdictContentDigest, obligation.instrumentIdentityDigest])
      riskAccountDigestSchemaV1.parse(value);
    if (nonnegative(obligation.quantity) === 0n) refuse("EXPECTED_OBLIGATION_IDENTITY");
    if (!/^[A-Z0-9]{1,24}$/.test(obligation.baseAsset) || obligation.baseAsset === "USDT" ||
        obligation.symbol !== `${obligation.baseAsset}/USDT`)
      refuse("EXPECTED_OBLIGATION_IDENTITY");
    if (obligation.state === "ISSUED") {
      if (obligation.orderId !== null || obligation.orderBindingDigest !== null || nonnegative(obligation.pendingNotional) !== 0n)
        refuse("EXPECTED_ISSUED_STATE");
      reservations += nonnegative(obligation.reservedNotional);
    } else if (obligation.state === "CONSUMED") {
      if (!obligation.orderId || !obligation.orderBindingDigest || orderIds.has(obligation.orderId))
        refuse("EXPECTED_CONSUMED_STATE");
      riskAccountDigestSchemaV1.parse(obligation.orderBindingDigest);
      orderIds.add(obligation.orderId);
      consumedPending += nonnegative(obligation.pendingNotional);
    } else refuse("EXPECTED_STATE");
    if (obligation.side === "SELL" && (nonnegative(obligation.reservedNotional) !== 0n || nonnegative(obligation.pendingNotional) !== 0n))
      refuse("REDUCTION_ACCOUNTING");
  }
  return { reservations, consumedPending };
}

/** Validates the sealed Expected frontier, then observes Actual. The delta still cannot publish. */
export function observeSealedExpectedFrontierV1(input: {
  expected: RiskExpectedFrontierV1;
  actualExposureNotional: string;
  actualPendingNotional: string;
  sourceMethodQualified: boolean;
  /** Null means the external debt is unattested. It is not treated as zero. */
  externalDebtNotional: string | null;
  /** Required once any obligation remains. Null is not a reference. */
  referenceDigest?: string | null;
  /** Null means no predecessor reference is attested, not that it matches. */
  priorReferenceDigest?: string | null;
  /** Null means no predecessor frontier is attested. Its notionals are not copied. */
  predecessor?: RiskExpectedFrontierV1 | null;
  /** Null means prior accounting exposure is unattested. It is not read from the predecessor frontier. */
  priorReconciledExposureNotional?: string | null;
  /** Null means the predecessor's external debt is unattested. It is not treated as zero. */
  priorExternalDebtNotional?: string | null;
}): ReturnType<typeof compareExpectedAccountFrontierV1> {
  const expected = input.expected;
  const stateVersion = sequence(expected.stateVersion);
  const nextAdmission = sequence(expected.nextAdmissionSequence);
  const nextEvent = sequence(expected.nextEventSequence);
  const predecessor = input.predecessor ?? null;
  let priorEvent: bigint | null = null;
  let priorAdmission: bigint | null = null;
  if (input.priorExternalDebtNotional != null && !predecessor) refuse("PREDECESSOR_SCOPE_OR_TIME");
  if (predecessor) {
    const priorState = sequence(predecessor.stateVersion);
    priorAdmission = sequence(predecessor.nextAdmissionSequence);
    priorEvent = sequence(predecessor.nextEventSequence);
    if (stateVersion < priorState || nextAdmission < priorAdmission || nextEvent < priorEvent)
      refuse("PREDECESSOR_SCOPE_OR_TIME");
    if (predecessor.eventHeadDigest !== null) riskAccountDigestSchemaV1.parse(predecessor.eventHeadDigest);
    if ((priorEvent === 1n) !== (predecessor.eventHeadDigest === null)) refuse("EXPECTED_SEQUENCE");
    const priorSums = sumExpectedObligationsV1(predecessor.obligations);
    if (priorSums.reservations !== nonnegative(predecessor.reservationNotional)) refuse("EXPECTED_RESERVATION_SUM");
    if (input.priorExternalDebtNotional != null) {
      const priorPending = nonnegative(predecessor.pendingExposureNotional);
      if (priorPending !== priorSums.consumedPending + nonnegative(input.priorExternalDebtNotional))
        refuse("EXPECTED_PENDING_SUM");
    }
  }
  if (expected.eventHeadDigest !== null) riskAccountDigestSchemaV1.parse(expected.eventHeadDigest);
  if ((nextEvent === 1n) !== (expected.eventHeadDigest === null)) refuse("EXPECTED_SEQUENCE");
  if (predecessor && priorEvent !== null) {
    const sameEvent = nextEvent === priorEvent;
    const sameHead = expected.eventHeadDigest === predecessor.eventHeadDigest;
    if (sameEvent !== sameHead) refuse("EXPECTED_SEQUENCE");
  }
  const sums = sumExpectedObligationsV1(expected.obligations);
  if (sums.reservations !== nonnegative(expected.reservationNotional)) refuse("EXPECTED_RESERVATION_SUM");
  if (predecessor) {
    const priorConsumedAllowances = new Set(predecessor.obligations.filter(row => row.state === "CONSUMED").map(row => row.allowanceId));
    const priorOrderIds = new Set(predecessor.obligations.flatMap(row => row.orderId ? [row.orderId] : []));
    for (const obligation of expected.obligations) {
      if (priorConsumedAllowances.has(obligation.allowanceId)) refuse("EXPECTED_OBLIGATION_IDENTITY");
      if (obligation.orderId && priorOrderIds.has(obligation.orderId)) refuse("EXPECTED_CONSUMED_STATE");
    }
    for (const prior of predecessor.obligations) {
      if (prior.state !== "ISSUED") continue;
      const current = expected.obligations.find(row => row.allowanceId === prior.allowanceId);
      if (!current || current.state !== "ISSUED" || current.quantity !== prior.quantity ||
          current.side !== prior.side || current.symbol !== prior.symbol || current.baseAsset !== prior.baseAsset ||
          current.instrumentIdentityDigest !== prior.instrumentIdentityDigest ||
          current.allowanceContentDigest !== prior.allowanceContentDigest ||
          current.verdictId !== prior.verdictId ||
          current.verdictContentDigest !== prior.verdictContentDigest ||
          current.pendingNotional !== prior.pendingNotional ||
          current.orderBindingDigest !== prior.orderBindingDigest ||
          current.reservedNotional !== prior.reservedNotional || current.orderId !== null)
        refuse("EXPECTED_OBLIGATION_IDENTITY");
    }
    const priorAllowances = new Set(predecessor.obligations.map(row => row.allowanceId));
    const addedAllowance = expected.obligations.some(row => !priorAllowances.has(row.allowanceId));
    if (addedAllowance && priorAdmission !== null && nextAdmission <= priorAdmission) refuse("EXPECTED_SEQUENCE");
  }
  const referenceDigest = input.referenceDigest ?? null;
  const priorReferenceDigest = input.priorReferenceDigest ?? null;
  if (expected.obligations.length > 0 && referenceDigest === null) refuse("REFERENCE_CURRENTNESS");
  if (referenceDigest !== null) riskAccountDigestSchemaV1.parse(referenceDigest);
  if (priorReferenceDigest !== null) riskAccountDigestSchemaV1.parse(priorReferenceDigest);
  if (expected.obligations.length > 0 && priorReferenceDigest !== null && priorReferenceDigest !== referenceDigest)
    refuse("REFERENCE_DRIFT_WITH_OBLIGATIONS");
  const reconciled = nonnegative(expected.reconciledExposureNotional);
  if (input.priorReconciledExposureNotional != null && reconciled !== nonnegative(input.priorReconciledExposureNotional))
    refuse("PREDECESSOR_SCOPE_OR_TIME");
  const declaredPending = nonnegative(expected.pendingExposureNotional);
  if (input.externalDebtNotional !== null && declaredPending !== sums.consumedPending + nonnegative(input.externalDebtNotional))
    refuse("EXPECTED_PENDING_SUM");
  return compareExpectedAccountFrontierV1({
    expectedExposureNotional: expected.reconciledExposureNotional,
    expectedPendingNotional: expected.pendingExposureNotional,
    actualExposureNotional: input.actualExposureNotional,
    actualPendingNotional: input.actualPendingNotional,
    sourceMethodQualified: input.sourceMethodQualified,
  });
}

/** One-use inclusion identities are held unpublished. A repeated truth record is refused.
 *  Nothing here writes an inclusion row or a current pointer.
 */
export function holdUnpublishedInclusionsV1(input: {
  truthRecordIds: readonly string[];
  alreadyDisposedTruthIds: readonly string[];
}): {
  disposition: "HELD_UNPUBLISHED";
  truthRecordIds: readonly string[];
  inclusionWrite: null;
  currentPointer: null;
} {
  const seen = new Set<string>();
  const take = (id: string) => {
    if (!riskAccountDigestSchemaV1.safeParse(id).success || seen.has(id)) refuse("INDEPENDENT_INCLUSION_IDENTITY");
    seen.add(id);
  };
  for (const id of input.alreadyDisposedTruthIds) take(id);
  const held: string[] = [];
  for (const id of input.truthRecordIds) {
    take(id);
    held.push(id);
  }
  return { disposition: "HELD_UNPUBLISHED", truthRecordIds: held, inclusionWrite: null, currentPointer: null };
}

/** Structural own-journal suffix. It does not recompute exposure and does not publish authority.
 *  declaredMaxEvents is the caller's already declared work bound. There is no default.
 */
export function authenticateExpectedEventSuffixV1(input: {
  predecessorHeadDigest: string | null;
  predecessorNextEventSequence: string;
  events: readonly { sequence: string; previousDigest: string | null; contentDigest: string }[];
  terminalHeadDigest: string | null;
  terminalNextEventSequence: string;
  declaredMaxEvents: number;
  predecessorReconciledExposureNotional: string;
  predecessorPendingExposureNotional: string;
  predecessorReservationNotional: string;
  terminalReconciledExposureNotional: string;
  terminalPendingExposureNotional: string;
  terminalReservationNotional: string;
}): { decision: "AUTHENTICATED"; eventCount: number; notionalsVerified: boolean; currentPointer: null } {
  if (!Number.isSafeInteger(input.declaredMaxEvents) || input.declaredMaxEvents < 1) refuse("SUFFIX_WORK_LIMIT");
  if (input.events.length > input.declaredMaxEvents) refuse("SUFFIX_WORK_LIMIT");
  let expectedSequence = sequence(input.predecessorNextEventSequence);
  let previous = input.predecessorHeadDigest;
  const seenDigests = new Set<string>();
  if (previous !== null) {
    riskAccountDigestSchemaV1.parse(previous);
    seenDigests.add(previous);
  }
  for (const event of input.events) {
    if (sequence(event.sequence) !== expectedSequence) refuse("EXPECTED_SEQUENCE");
    if (event.previousDigest !== previous) refuse("EXPECTED_SEQUENCE");
    if (event.previousDigest !== null) riskAccountDigestSchemaV1.parse(event.previousDigest);
    riskAccountDigestSchemaV1.parse(event.contentDigest);
    if (seenDigests.has(event.contentDigest)) refuse("EXPECTED_SEQUENCE");
    seenDigests.add(event.contentDigest);
    previous = event.contentDigest;
    expectedSequence += 1n;
  }
  if (sequence(input.terminalNextEventSequence) !== expectedSequence) refuse("EXPECTED_SEQUENCE");
  if (input.terminalHeadDigest !== previous) refuse("EXPECTED_SEQUENCE");
  if (input.terminalHeadDigest !== null) riskAccountDigestSchemaV1.parse(input.terminalHeadDigest);
  const sameNotional = (left: string, right: string) => nonnegative(left) === nonnegative(right);
  const notionalsVerified = input.events.length === 0;
  if (notionalsVerified && !(
    sameNotional(input.predecessorReconciledExposureNotional, input.terminalReconciledExposureNotional) &&
    sameNotional(input.predecessorPendingExposureNotional, input.terminalPendingExposureNotional) &&
    sameNotional(input.predecessorReservationNotional, input.terminalReservationNotional)
  )) refuse("SUFFIX_TERMINAL_MISMATCH");
  if (!notionalsVerified) {
    nonnegative(input.predecessorReconciledExposureNotional);
    nonnegative(input.predecessorPendingExposureNotional);
    nonnegative(input.predecessorReservationNotional);
    nonnegative(input.terminalReconciledExposureNotional);
    nonnegative(input.terminalPendingExposureNotional);
    nonnegative(input.terminalReservationNotional);
  }
  return { decision: "AUTHENTICATED", eventCount: input.events.length, notionalsVerified, currentPointer: null };
}

const ENFORCEMENT_SUFFIX_TYPES = ["ALLOWANCE_ISSUED", "ALLOWANCE_CONSUMED", "ALLOWANCE_REVOKED", "ALLOWANCE_EXPIRED", "CONSUMPTION_REFUSED"] as const;
const ENFORCEMENT_TRANSITION = {
  ALLOWANCE_ISSUED: { fromState: null, toState: "ISSUED" },
  ALLOWANCE_CONSUMED: { fromState: "ISSUED", toState: "CONSUMED" },
  ALLOWANCE_REVOKED: { fromState: "ISSUED", toState: "REVOKED" },
  ALLOWANCE_EXPIRED: { fromState: "ISSUED", toState: "EXPIRED" },
  CONSUMPTION_REFUSED: { fromState: "ISSUED", toState: "REVOKED" },
} as const;

/** Recomputes reservation and pending from the existing enforcement effects.
 *  These events do not change reconciled exposure. A match still publishes nothing.
 */
export function foldExpectedEnforcementSuffixV1(input: {
  predecessorHeadDigest: string | null;
  predecessorNextEventSequence: string;
  predecessorNextAdmissionSequence: string;
  predecessorReconciledExposureNotional: string;
  predecessorPendingExposureNotional: string;
  predecessorReservationNotional: string;
  predecessorStateVersion: string;
  openedAllowances: readonly { allowanceId: string; reservedExposureNotional: string; quantity: string; riskVerdictId: string }[];
  closedAllowances: readonly { allowanceId: string; reservedExposureNotional: string; quantity: string; disposition: "CONSUMED" | "RELEASED"; riskVerdictId: string | null; boundOrderId: string | null; boundOrderDigestHex: string | null; truthRecordId?: string | null }[];
  events: readonly {
    sequence: string;
    previousDigest: string | null;
    contentDigest: string;
    type: (typeof ENFORCEMENT_SUFFIX_TYPES)[number];
    organizationId: string;
    accountId: string;
    fromState: "ISSUED" | "CONSUMED" | "REVOKED" | "EXPIRED" | null;
    toState: "ISSUED" | "CONSUMED" | "REVOKED" | "EXPIRED" | null;
    allowanceId: string;
    reservedExposureNotional: string;
    quantity: string;
    riskVerdictId: string;
    boundOrderId: string | null;
    boundOrderDigestHex: string | null;
    reasonCode: string | null;
    truthRecordId?: string | null;
  }[];
  alreadyDisposedTruthIds: readonly string[];
  terminalHeadDigest: string | null;
  terminalNextEventSequence: string;
  terminalNextAdmissionSequence: string;
  terminalReconciledExposureNotional: string;
  terminalPendingExposureNotional: string;
  terminalReservationNotional: string;
  terminalStateVersion: string;
  terminalOpenAllowances: readonly { allowanceId: string; reservedExposureNotional: string; quantity: string; riskVerdictId: string; boundOrderId: null; boundOrderDigestHex: null }[];
  terminalConsumedAllowances: readonly { allowanceId: string; reservedExposureNotional: string; quantity: string; riskVerdictId: string; boundOrderId: string; boundOrderDigestHex: string }[];
  organizationId: string;
  accountId: string;
  declaredMaxEvents: number;
}): { decision: "AUTHENTICATED"; eventCount: number; notionalsVerified: true; heldTruthRecordIds: readonly string[]; currentPointer: null } {
  if (input.organizationId.length === 0 || input.accountId.length === 0) refuse("SUFFIX_SCOPE_MISMATCH");
  authenticateExpectedEventSuffixV1({
    predecessorHeadDigest: input.predecessorHeadDigest,
    predecessorNextEventSequence: input.predecessorNextEventSequence,
    events: input.events,
    terminalHeadDigest: input.terminalHeadDigest,
    terminalNextEventSequence: input.terminalNextEventSequence,
    declaredMaxEvents: input.declaredMaxEvents,
    predecessorReconciledExposureNotional: input.predecessorReconciledExposureNotional,
    predecessorPendingExposureNotional: input.predecessorPendingExposureNotional,
    predecessorReservationNotional: input.predecessorReservationNotional,
    terminalReconciledExposureNotional: input.terminalReconciledExposureNotional,
    terminalPendingExposureNotional: input.terminalPendingExposureNotional,
    terminalReservationNotional: input.terminalReservationNotional,
  });
  if (nonnegative(input.predecessorReconciledExposureNotional) !== nonnegative(input.terminalReconciledExposureNotional)) {
    refuse("SUFFIX_TERMINAL_MISMATCH");
  }
  let reservation = nonnegative(input.predecessorReservationNotional);
  let pending = nonnegative(input.predecessorPendingExposureNotional);
  const open = new Map<string, { reserved: bigint; quantity: bigint; verdict: string }>();
  const consumed = new Map<string, { reserved: bigint; quantity: bigint; verdict: string; orderId: string; orderDigest: string }>();
  const orderIds = new Set<string>();
  const closed = new Set<string>();
  const positiveQuantity = (value: string) => {
    const quantity = nonnegative(value);
    if (quantity === 0n) refuse("EXPECTED_OBLIGATION_IDENTITY");
    return quantity;
  };
  let explained = 0n;
  for (const prior of input.openedAllowances) {
    if (!prior.allowanceId || open.has(prior.allowanceId) || closed.has(prior.allowanceId)) refuse("EXPECTED_OBLIGATION_IDENTITY");
    const reserved = nonnegative(prior.reservedExposureNotional);
    if (!prior.riskVerdictId) refuse("EXPECTED_OBLIGATION_IDENTITY");
    open.set(prior.allowanceId, { reserved, quantity: positiveQuantity(prior.quantity), verdict: prior.riskVerdictId });
    explained += reserved;
  }
  let explainedPending = 0n;
  for (const prior of input.closedAllowances) {
    if (!prior.allowanceId || open.has(prior.allowanceId) || closed.has(prior.allowanceId)) refuse("EXPECTED_OBLIGATION_IDENTITY");
    if (prior.disposition !== "CONSUMED" && prior.disposition !== "RELEASED") refuse("EXPECTED_STATE");
    const reserved = nonnegative(prior.reservedExposureNotional);
    const quantity = positiveQuantity(prior.quantity);
    closed.add(prior.allowanceId);
    if (prior.disposition === "CONSUMED") {
      if (!prior.riskVerdictId || !prior.boundOrderId || prior.boundOrderDigestHex === null || orderIds.has(prior.boundOrderId)) refuse("EXPECTED_CONSUMED_STATE");
      riskAccountDigestSchemaV1.parse(prior.boundOrderDigestHex);
      orderIds.add(prior.boundOrderId);
      consumed.set(prior.allowanceId, { reserved, quantity, verdict: prior.riskVerdictId, orderId: prior.boundOrderId, orderDigest: prior.boundOrderDigestHex });
      explainedPending += reserved;
    } else if (prior.riskVerdictId !== null || prior.boundOrderId !== null || prior.boundOrderDigestHex !== null) refuse("EXPECTED_STATE");
  }
  if (explained !== reservation || explainedPending !== pending) refuse("EXPECTED_RESERVATION_SUM");
  const disposed = new Set<string>();
  for (const id of input.alreadyDisposedTruthIds) {
    if (!riskAccountDigestSchemaV1.safeParse(id).success || disposed.has(id)) refuse("INDEPENDENT_INCLUSION_IDENTITY");
    disposed.add(id);
  }
  for (const prior of input.closedAllowances) {
    if (prior.disposition === "RELEASED" && prior.truthRecordId != null) refuse("EXPECTED_STATE");
    if (prior.disposition === "CONSUMED" && prior.truthRecordId != null) {
      if (!riskAccountDigestSchemaV1.safeParse(prior.truthRecordId).success || disposed.has(prior.truthRecordId)) {
        refuse("INDEPENDENT_INCLUSION_IDENTITY");
      }
      disposed.add(prior.truthRecordId);
    }
  }
  const heldTruthRecordIds: string[] = [];
  let issued = 0n;
  for (const event of input.events) {
    if (!(ENFORCEMENT_SUFFIX_TYPES as readonly string[]).includes(event.type)) refuse("EXPECTED_STATE");
    if (event.organizationId !== input.organizationId || event.accountId !== input.accountId) refuse("SUFFIX_SCOPE_MISMATCH");
    const transition = ENFORCEMENT_TRANSITION[event.type];
    if (event.fromState !== transition.fromState || event.toState !== transition.toState) refuse("EXPECTED_STATE");
    const reasonRequired = event.type === "ALLOWANCE_REVOKED" || event.type === "ALLOWANCE_EXPIRED" || event.type === "CONSUMPTION_REFUSED";
    if (reasonRequired ? !event.reasonCode : event.reasonCode !== null) refuse("EXPECTED_STATE");
    const reserved = nonnegative(event.reservedExposureNotional);
    if (!event.allowanceId) refuse("EXPECTED_OBLIGATION_IDENTITY");
    if (event.type !== "ALLOWANCE_CONSUMED" && event.truthRecordId != null) refuse("EXPECTED_STATE");
    if (event.type === "ALLOWANCE_ISSUED") {
      if (open.has(event.allowanceId) || closed.has(event.allowanceId)) refuse("EXPECTED_OBLIGATION_IDENTITY");
      if (!event.riskVerdictId || event.boundOrderId !== null || event.boundOrderDigestHex !== null) refuse("EXPECTED_STATE");
      open.set(event.allowanceId, { reserved, quantity: positiveQuantity(event.quantity), verdict: event.riskVerdictId });
      reservation += reserved;
      issued += 1n;
    } else {
      const held = open.get(event.allowanceId);
      const quantity = positiveQuantity(event.quantity);
      if (held === undefined || held.reserved !== reserved || held.quantity !== quantity || held.verdict !== event.riskVerdictId) refuse("EXPECTED_OBLIGATION_IDENTITY");
      if (event.type === "ALLOWANCE_CONSUMED") {
        if (!event.boundOrderId || event.boundOrderDigestHex === null || orderIds.has(event.boundOrderId)) refuse("EXPECTED_CONSUMED_STATE");
        riskAccountDigestSchemaV1.parse(event.boundOrderDigestHex);
        orderIds.add(event.boundOrderId);
        consumed.set(event.allowanceId, { reserved, quantity, verdict: event.riskVerdictId, orderId: event.boundOrderId, orderDigest: event.boundOrderDigestHex });
      } else if (event.boundOrderId !== null || event.boundOrderDigestHex !== null) refuse("EXPECTED_STATE");
      open.delete(event.allowanceId);
      closed.add(event.allowanceId);
      if (reservation < reserved) refuse("EXPECTED_RESERVATION_SUM");
      reservation -= reserved;
      if (event.type === "ALLOWANCE_CONSUMED") {
        pending += reserved;
        if (event.truthRecordId != null) {
          if (!riskAccountDigestSchemaV1.safeParse(event.truthRecordId).success || disposed.has(event.truthRecordId)) {
            refuse("INDEPENDENT_INCLUSION_IDENTITY");
          }
          disposed.add(event.truthRecordId);
          heldTruthRecordIds.push(event.truthRecordId);
        }
      } else if (event.truthRecordId != null) refuse("EXPECTED_STATE");
    }
  }
  if (sequence(input.terminalNextAdmissionSequence) !== sequence(input.predecessorNextAdmissionSequence) + issued) {
    refuse("EXPECTED_SEQUENCE");
  }
  if (reservation !== nonnegative(input.terminalReservationNotional) || pending !== nonnegative(input.terminalPendingExposureNotional)) {
    refuse("SUFFIX_TERMINAL_MISMATCH");
  }
  const listed = new Map<string, { reserved: bigint; quantity: bigint; verdict: string }>();
  for (const row of input.terminalOpenAllowances) {
    if (!row.allowanceId || !row.riskVerdictId || listed.has(row.allowanceId)) refuse("EXPECTED_OBLIGATION_IDENTITY");
    if (row.boundOrderId !== null || row.boundOrderDigestHex !== null) refuse("EXPECTED_STATE");
    listed.set(row.allowanceId, { reserved: nonnegative(row.reservedExposureNotional), quantity: positiveQuantity(row.quantity), verdict: row.riskVerdictId });
  }
  if (listed.size !== open.size) refuse("EXPECTED_OBLIGATION_IDENTITY");
  for (const [id, held] of open) {
    const row = listed.get(id);
    if (row === undefined || row.reserved !== held.reserved || row.quantity !== held.quantity || row.verdict !== held.verdict) refuse("EXPECTED_OBLIGATION_IDENTITY");
  }
  const listedConsumed = new Map<string, { reserved: bigint; quantity: bigint; verdict: string; orderId: string; orderDigest: string }>();
  for (const row of input.terminalConsumedAllowances) {
    if (!row.allowanceId || !row.riskVerdictId || !row.boundOrderId || listedConsumed.has(row.allowanceId) || open.has(row.allowanceId)) refuse("EXPECTED_OBLIGATION_IDENTITY");
    riskAccountDigestSchemaV1.parse(row.boundOrderDigestHex);
    listedConsumed.set(row.allowanceId, { reserved: nonnegative(row.reservedExposureNotional), quantity: positiveQuantity(row.quantity), verdict: row.riskVerdictId, orderId: row.boundOrderId, orderDigest: row.boundOrderDigestHex });
  }
  if (listedConsumed.size !== consumed.size) refuse("EXPECTED_OBLIGATION_IDENTITY");
  for (const [id, held] of consumed) {
    const row = listedConsumed.get(id);
    if (row === undefined || row.reserved !== held.reserved || row.quantity !== held.quantity || row.verdict !== held.verdict || row.orderId !== held.orderId || row.orderDigest !== held.orderDigest) refuse("EXPECTED_OBLIGATION_IDENTITY");
  }
  if (sequence(input.terminalStateVersion) !== sequence(input.predecessorStateVersion) + BigInt(input.events.length)) {
    refuse("EXPECTED_SEQUENCE");
  }
  return { decision: "AUTHENTICATED", eventCount: input.events.length, notionalsVerified: true, heldTruthRecordIds, currentPointer: null };
}
