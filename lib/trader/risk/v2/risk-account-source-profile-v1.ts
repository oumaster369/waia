import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { DECIMAL_SCALE_FACTOR, formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";

export const RISK_ACCOUNT_PROFILE_V1 = "risk-account-source-profile/v1" as const;
export const RISK_REFERENCE_METHOD_V1 = "htx-temporal-ask-median/exact-scale8/v1" as const;
export const RISK_ACCOUNT_CHANNELS_V1 = [
  "EXTERNAL_ORDINARY_ORDER", "EXTERNAL_CONDITIONAL_ORDER", "DEPOSIT", "WITHDRAWAL",
  "INTERNAL_TRANSFER", "FEE", "OTHER_EXTERNAL_MUTATION",
] as const;

export class RiskCurrentAccountRefusedV1 extends Error {
  constructor(readonly reason: string) {
    super(`[trader] current account authority refused: ${reason}`);
    this.name = "RiskCurrentAccountRefusedV1";
  }
}

export const riskAccountDigestSchemaV1 = z.string().regex(/^[0-9a-f]{64}$/);
export const riskAccountIdentitySchemaV1 = z.string().min(1).max(256);
export const riskAccountTimeSchemaV1 = z.string().datetime({ offset: true }).refine(
  value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
);
export const riskAccountDecimalSchemaV1 = z.string().max(80).refine(value => {
  try { return parseDecimal(value) >= 0n && formatDecimal(parseDecimal(value)) === value; }
  catch { return false; }
}, "canonical nonnegative scale8 decimal required");
const positive = riskAccountDecimalSchemaV1.refine(value => parseDecimal(value) > 0n);
const duration = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const asset = z.string().regex(/^[A-Z0-9]{1,24}$/);

/** Integrity only. This digest is never an issuer or a current-authority proof. */
export function riskAccountDigestV1(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

export type SealedRiskAccountRecordV1<T> = Readonly<T & { contentDigest: string }>;
export function sealRiskAccountRecordV1<T extends object>(value: T): SealedRiskAccountRecordV1<T> {
  const copy: T = JSON.parse(canonicalJsonString(value));
  if ("contentDigest" in copy) throw new RiskCurrentAccountRefusedV1("PRESEALED_DRAFT");
  return freezeTree({ ...copy, contentDigest: riskAccountDigestV1(copy) });
}

export function assertRiskAccountRecordSealV1<T extends { contentDigest: string }>(value: T): T {
  const { contentDigest, ...body } = value;
  if (!riskAccountDigestSchemaV1.safeParse(contentDigest).success ||
      contentDigest !== riskAccountDigestV1(body)) throw new RiskCurrentAccountRefusedV1("RECORD_SEAL");
  return value;
}

/** Refuse rather than let the existing integer division truncate a conservative charge. */
export function exactRiskAccountNotionalV1(quantity: string, referencePrice: string): string {
  const q = parseDecimal(riskAccountDecimalSchemaV1.parse(quantity));
  const p = parseDecimal(positive.parse(referencePrice));
  const product = q * p;
  if (product % DECIMAL_SCALE_FACTOR !== 0n) throw new RiskCurrentAccountRefusedV1("NOTIONAL_PRECISION");
  return formatDecimal(product / DECIMAL_SCALE_FACTOR);
}

export const riskAccountRawEvidenceSchemaV1 = z.object({
  sourceId: z.string().uuid(),
  captureReceiptDigest: riskAccountDigestSchemaV1,
  storageBindingDigest: riskAccountDigestSchemaV1,
  validationReceiptDigest: riskAccountDigestSchemaV1,
  rawBytesDigest: riskAccountDigestSchemaV1,
}).strict();

const qualificationSchema = z.object({
  evidence: riskAccountRawEvidenceSchemaV1,
  methodVersion: z.literal(RISK_REFERENCE_METHOD_V1),
  statementDigest: riskAccountDigestSchemaV1,
  validFromUtc: riskAccountTimeSchemaV1,
  validUntilUtc: riskAccountTimeSchemaV1,
  reportTimeSemantics: z.literal("HTX_RESPONSE_GENERATION_WITH_QUALIFIED_SIDE_AGE_BOUND"),
  venueDependence: z.literal("SINGLE_VENUE_HTX"),
}).strict();

export const riskAccountInstrumentSchemaV1 = z.object({
  instrumentIdentityDigestHex: riskAccountDigestSchemaV1,
  symbol: z.string().regex(/^[A-Z0-9]+\/USDT$/),
  baseAsset: asset,
  quoteAsset: z.literal("USDT"),
  referenceSourceId: z.string().uuid(),
}).strict().refine(value => value.symbol === `${value.baseAsset}/USDT` && value.baseAsset !== "USDT",
  "instrument/base/quote identity mismatch");

/** All quantities and intervals are explicit governed inputs, never inferred from a cap. */
export const riskAccountProfileDraftSchemaV1 = z.object({
  organizationId: z.string().uuid(),
  accountId: riskAccountIdentitySchemaV1,
  credentialId: z.string().uuid(),
  exchangeAccountId: z.string().regex(/^[1-9]\d{0,39}$/),
  accountSourceId: z.string().uuid(),
  venue: z.literal("HTX"),
  market: z.literal("SPOT"),
  referenceCurrency: z.literal("USDT"),
  instruments: z.array(riskAccountInstrumentSchemaV1).min(1).max(32),
  assets: z.array(asset).min(2).max(64),
  strategyId: riskAccountIdentitySchemaV1,
  strategyVersion: riskAccountIdentitySchemaV1,
  sourceContract: z.object({
    evidence: riskAccountRawEvidenceSchemaV1,
    statementDigest: riskAccountDigestSchemaV1,
    anchorMethod: z.literal("INDEPENDENT_SOURCE_ASSERTED_DATED_ACCOUNT"),
    validFromUtc: riskAccountTimeSchemaV1,
    validUntilUtc: riskAccountTimeSchemaV1,
    maxSourceAgeMs: duration,
    maxReportClockSkewMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    coveredAssetSetDigest: riskAccountDigestSchemaV1,
  }).strict(),
  mutationBounds: z.array(z.object({
    asset,
    channel: z.enum(RISK_ACCOUNT_CHANNELS_V1),
    intervalStartUtc: riskAccountTimeSchemaV1,
    intervalEndUtc: riskAccountTimeSchemaV1,
    maximumPositiveQuantity: riskAccountDecimalSchemaV1,
    maximumNegativeQuantity: riskAccountDecimalSchemaV1,
    contractStatementDigest: riskAccountDigestSchemaV1,
  }).strict()).min(1).max(448),
  reference: z.object({
    qualification: qualificationSchema,
    windowDurationMs: duration,
    slotOffsetsMs: z.array(z.number().int().nonnegative()).min(2).max(512),
    slotToleranceMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    maxSideAgeMs: duration,
    validityMs: duration,
  }).strict(),
  allocation: z.object({
    evidence: riskAccountRawEvidenceSchemaV1,
    statementDigest: riskAccountDigestSchemaV1,
    allocationId: riskAccountIdentitySchemaV1,
    version: riskAccountIdentitySchemaV1,
    approvedNotional: positive,
    allowedSymbols: z.array(z.string().regex(/^[A-Z0-9]+\/USDT$/)).min(1).max(32),
    validFromUtc: riskAccountTimeSchemaV1,
    validUntilUtc: riskAccountTimeSchemaV1,
  }).strict(),
  governance: z.object({ coolingOffMs: duration, reviewReason: z.string().min(1).max(2048) }).strict(),
  work: z.object({
    maxRawBytes: z.number().int().min(1).max(1048576),
    requestTimeoutMs: z.number().int().min(1).max(120000),
    maxPages: z.number().int().min(1).max(512),
    maxMembers: z.number().int().min(1).max(8192),
    maxLedgerEvents: z.number().int().min(1).max(8192),
    retentionSeconds: z.number().int().positive().max(315360000),
  }).strict(),
}).strict();

export type RiskAccountProfileDraftV1 = z.infer<typeof riskAccountProfileDraftSchemaV1>;
export type RiskAccountProfileV1 = SealedRiskAccountRecordV1<RiskAccountProfileDraftV1 & {
  schemaVersion: typeof RISK_ACCOUNT_PROFILE_V1;
}>;

export function createRiskAccountProfileV1(input: RiskAccountProfileDraftV1): RiskAccountProfileV1 {
  const draft = riskAccountProfileDraftSchemaV1.parse(input);
  const sortedUnique = (values: readonly string[]) => values.length === new Set(values).size &&
    values.every((value, index) => index === 0 || values[index - 1]! < value);
  if (!sortedUnique(draft.assets) || !draft.assets.includes("USDT") ||
      !sortedUnique(draft.instruments.map(i => i.symbol)) ||
      !sortedUnique(draft.allocation.allowedSymbols) ||
      !draft.instruments.every(i => draft.assets.includes(i.baseAsset) &&
        draft.allocation.allowedSymbols.includes(i.symbol)) ||
      draft.assets.some(a => a !== "USDT" && !draft.instruments.some(i => i.baseAsset === a)) ||
      draft.sourceContract.coveredAssetSetDigest !== riskAccountDigestV1(draft.assets))
    throw new RiskCurrentAccountRefusedV1("PROFILE_ASSET_COVERAGE");
  const offsets = draft.reference.slotOffsetsMs;
  if (offsets[0] !== 0 || offsets.some((n, i) => n >= draft.reference.windowDurationMs ||
      i > 0 && n <= offsets[i - 1]!) ||
      offsets.length * draft.instruments.length > draft.work.maxMembers)
    throw new RiskCurrentAccountRefusedV1("REFERENCE_SCHEDULE");
  for (const interval of [draft.sourceContract, draft.reference.qualification, draft.allocation]) {
    if (Date.parse(interval.validFromUtc) >= Date.parse(interval.validUntilUtc))
      throw new RiskCurrentAccountRefusedV1("PROFILE_INTERVAL");
  }
  const keys = new Set<string>();
  for (const bound of draft.mutationBounds) {
    const key = `${bound.asset}:${bound.channel}`;
    if (keys.has(key) || !draft.assets.includes(bound.asset) ||
        Date.parse(bound.intervalStartUtc) >= Date.parse(bound.intervalEndUtc) ||
        bound.contractStatementDigest !== draft.sourceContract.statementDigest)
      throw new RiskCurrentAccountRefusedV1("MUTATION_COVERAGE");
    keys.add(key);
  }
  if (draft.assets.some(a => RISK_ACCOUNT_CHANNELS_V1.some(channel => !keys.has(`${a}:${channel}`))))
    throw new RiskCurrentAccountRefusedV1("MUTATION_COVERAGE");
  return sealRiskAccountRecordV1({ ...draft, schemaVersion: RISK_ACCOUNT_PROFILE_V1 });
}

export function parseRiskAccountProfileV1(value: unknown): RiskAccountProfileV1 {
  const record = z.object({ contentDigest: riskAccountDigestSchemaV1,
    schemaVersion: z.literal(RISK_ACCOUNT_PROFILE_V1) }).passthrough().parse(value);
  const { contentDigest, schemaVersion: _version, ...draft } = record;
  void _version;
  const rebuilt = createRiskAccountProfileV1(riskAccountProfileDraftSchemaV1.parse(draft));
  if (contentDigest !== rebuilt.contentDigest) throw new RiskCurrentAccountRefusedV1("PROFILE_SEAL");
  return rebuilt;
}

export type RiskReferenceMemberV1 = SealedRiskAccountRecordV1<{
  schemaVersion: "risk-reference-member/v1";
  organizationId: string; accountId: string; profileDigest: string;
  windowId: string; slot: number; instrumentIdentityDigestHex: string; symbol: string;
  baseAsset: string; quoteAsset: "USDT";
  sourceId: string; sourceReportTimeUtc: string; availableAtUtc: string;
  captureReceiptDigest: string; storageBindingDigest: string; validationReceiptDigest: string;
  rawBytesDigest: string; rawMemberPath: "tick"; decoderVersion: string;
  normalizedInputDigest: string; gatewayReceiptDigest: string;
  observationId: string; observationContentDigest: string; trustAsOfReceiptId: string;
  bid: string; ask: string; last: string;
}>;

export type RiskAccountReferenceV1 = SealedRiskAccountRecordV1<{
  schemaVersion: "risk-account-reference/v1";
  organizationId: string; accountId: string; profileDigest: string;
  methodVersion: typeof RISK_REFERENCE_METHOD_V1;
  windowId: string; windowStartUtc: string; assembledAtUtc: string; validUntilUtc: string;
  members: readonly string[];
  prices: readonly { asset: string; symbol: string; instrumentIdentityDigestHex: string; price: string }[];
}>;

/** Value construction only; persistence authenticates each member and current qualification. */
export function createRiskAccountReferenceV1(input: {
  profile: RiskAccountProfileV1; windowId: string; windowStartUtc: string; assembledAtUtc: string;
  members: readonly RiskReferenceMemberV1[];
}): RiskAccountReferenceV1 {
  const profile = parseRiskAccountProfileV1(input.profile);
  riskAccountTimeSchemaV1.parse(input.windowStartUtc);
  riskAccountTimeSchemaV1.parse(input.assembledAtUtc);
  riskAccountIdentitySchemaV1.parse(input.windowId);
  const start = Date.parse(input.windowStartUtc), asOf = Date.parse(input.assembledAtUtc);
  const windowEnd = start + profile.reference.windowDurationMs;
  const qualification = profile.reference.qualification;
  if (!Number.isSafeInteger(windowEnd) || start < Date.parse(qualification.validFromUtc) || asOf < windowEnd ||
      asOf >= Date.parse(qualification.validUntilUtc) ||
      input.members.length !== profile.reference.slotOffsetsMs.length * profile.instruments.length)
    throw new RiskCurrentAccountRefusedV1("REFERENCE_WINDOW");
  const members = [...input.members];
  const identities = new Set<string>();
  const prices = profile.instruments.map(instrument => {
    const selected = members.filter(m => m.instrumentIdentityDigestHex === instrument.instrumentIdentityDigestHex)
      .sort((a, b) => a.slot - b.slot);
    if (selected.length !== profile.reference.slotOffsetsMs.length) throw new RiskCurrentAccountRefusedV1("REFERENCE_MEMBERS");
    for (const [slot, member] of selected.entries()) {
      assertRiskAccountRecordSealV1(member);
      const planned = start + profile.reference.slotOffsetsMs[slot]!;
      const report = Date.parse(member.sourceReportTimeUtc), available = Date.parse(member.availableAtUtc);
      if (member.schemaVersion !== "risk-reference-member/v1" || member.organizationId !== profile.organizationId ||
          member.accountId !== profile.accountId || member.profileDigest !== profile.contentDigest ||
          member.windowId !== input.windowId || member.slot !== slot || member.symbol !== instrument.symbol ||
          member.baseAsset !== instrument.baseAsset || member.quoteAsset !== "USDT" ||
          member.sourceId !== instrument.referenceSourceId || identities.has(member.observationId) ||
          !Number.isFinite(report) || !Number.isFinite(available) || report > available || available > asOf ||
          Math.abs(available - planned) > profile.reference.slotToleranceMs ||
          available - report > profile.reference.maxSideAgeMs ||
          parseDecimal(positive.parse(member.bid)) > parseDecimal(positive.parse(member.ask)))
        throw new RiskCurrentAccountRefusedV1("REFERENCE_MEMBER_IDENTITY_OR_TIME");
      positive.parse(member.last);
      identities.add(member.observationId);
    }
    const asks = selected.map(m => parseDecimal(m.ask)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return { asset: instrument.baseAsset, symbol: instrument.symbol,
      instrumentIdentityDigestHex: instrument.instrumentIdentityDigestHex,
      price: formatDecimal(asks[Math.floor(asks.length / 2)]!) };
  });
  // Delayed assembly/replay cannot restart a fixed retained window's validity.
  const validUntil = Math.min(windowEnd + profile.reference.validityMs, Date.parse(qualification.validUntilUtc),
    Date.parse(profile.sourceContract.validUntilUtc), Date.parse(profile.allocation.validUntilUtc));
  if (!Number.isSafeInteger(validUntil) || validUntil <= asOf) throw new RiskCurrentAccountRefusedV1("REFERENCE_EXPIRED");
  return sealRiskAccountRecordV1({ schemaVersion: "risk-account-reference/v1" as const,
    organizationId: profile.organizationId, accountId: profile.accountId, profileDigest: profile.contentDigest,
    methodVersion: RISK_REFERENCE_METHOD_V1, windowId: input.windowId, windowStartUtc: input.windowStartUtc,
    assembledAtUtc: input.assembledAtUtc, validUntilUtc: new Date(validUntil).toISOString(),
    members: members.map(m => m.contentDigest).sort(), prices });
}
