import { z } from "zod";
import { parseDecimal } from "@/lib/trader/risk/numeric";
import {
  RiskCurrentAccountRefusedV1,
  assertRiskAccountRecordSealV1,
  riskAccountDecimalSchemaV1,
  riskAccountDigestSchemaV1,
  riskAccountIdentitySchemaV1,
  riskAccountTimeSchemaV1,
  sealRiskAccountRecordV1,
} from "@/lib/trader/risk/v2/risk-account-source-profile-v1";

export const LIVE_CAPITAL_ENVELOPE_V2 = "live-capital-envelope/v2" as const;
export const LIVE_CAPITAL_BASIS_BINDING_V1 = "live-capital-basis-binding/v1" as const;
export const LIVE_CAPITAL_ENVELOPE_JOURNAL_V2 = "live-capital-envelope-journal/v2" as const;
export const LIVE_CAPITAL_ENVELOPE_STAGES_V2 = [
  "CAPTURED",
  "SEALED",
  "ADMITTED",
  "PUBLISHED",
] as const;
export type LiveCapitalEnvelopeStageV2 = (typeof LIVE_CAPITAL_ENVELOPE_STAGES_V2)[number];

const uuid = z.string().uuid();
/** Envelope notionals only. Zero stays valid for other risk decimals. */
const positiveEnvelopeNotionalV2 = riskAccountDecimalSchemaV1.refine(
  (value) => parseDecimal(value) > 0n,
  "canonical positive scale8 decimal required",
);

function requirePositiveWindow(
  value: { validFromUtc: string; validUntilUtc: string },
  context: z.RefinementCtx,
): void {
  if (Date.parse(value.validUntilUtc) <= Date.parse(value.validFromUtc)) {
    context.addIssue({ code: "custom", message: "WINDOW", path: ["validUntilUtc"] });
  }
}

/** Operator command. Every amount and window is required. This module has no amount default. */
const liveCapitalEnvelopeCommandObjectV2 = z
  .object({
    commandId: uuid,
    organizationId: uuid,
    accountId: riskAccountIdentitySchemaV1,
    policyDigest: riskAccountDigestSchemaV1,
    releaseSha: riskAccountDigestSchemaV1,
    capitalNotional: positiveEnvelopeNotionalV2,
    lossLimitNotional: positiveEnvelopeNotionalV2,
    validFromUtc: riskAccountTimeSchemaV1,
    validUntilUtc: riskAccountTimeSchemaV1,
  })
  .strict();
export const liveCapitalEnvelopeCommandSchemaV2 =
  liveCapitalEnvelopeCommandObjectV2.superRefine(requirePositiveWindow);
export type LiveCapitalEnvelopeCommandV2 = Readonly<
  z.infer<typeof liveCapitalEnvelopeCommandSchemaV2>
>;

const envelopeBodySchema = liveCapitalEnvelopeCommandObjectV2
  .extend({
    schemaVersion: z.literal(LIVE_CAPITAL_ENVELOPE_V2),
  })
  .strict()
  .superRefine(requirePositiveWindow);

export type LiveCapitalEnvelopeReceiptV2 = Readonly<
  z.infer<typeof envelopeBodySchema> & { contentDigest: string }
>;
export type LiveCapitalEnvelopeBoundV2 = Readonly<{
  organizationId: string;
  accountId: string;
  policyDigest: string;
  releaseSha: string;
  nowUtc: string;
}>;

export type LiveCapitalBasisBindingV2 = Readonly<{
  schemaVersion: typeof LIVE_CAPITAL_BASIS_BINDING_V1;
  organizationId: string;
  accountId: string;
  policyDigest: string;
  releaseSha: string;
  envelopeDigest: string;
  capitalNotional: string;
  lossLimitNotional: string;
  validFromUtc: string;
  validUntilUtc: string;
  contentDigest: string;
}>;

function refuse(reason: string): never {
  throw new RiskCurrentAccountRefusedV1(reason);
}

function rejectNonAuthorityFields(value: object): void {
  if ("heartbeat" in value) refuse("HEARTBEAT_IS_NOT_AUTHORITY");
  if ("authorized" in value || "enabled" in value || "liveEnabled" in value)
    refuse("AUTHORITY_BOOLEAN_FORBIDDEN");
}

/** Seals an operator command. Amounts are copied from that command and never filled in here. */
export function sealLiveCapitalEnvelopeV2(
  command: LiveCapitalEnvelopeCommandV2,
): LiveCapitalEnvelopeReceiptV2 {
  rejectNonAuthorityFields(command);
  const parsed = liveCapitalEnvelopeCommandSchemaV2.parse(command);
  return sealRiskAccountRecordV1({ schemaVersion: LIVE_CAPITAL_ENVELOPE_V2, ...parsed });
}

export function assertLiveCapitalEnvelopeReceiptV2(
  value: LiveCapitalEnvelopeReceiptV2,
): LiveCapitalEnvelopeReceiptV2 {
  rejectNonAuthorityFields(value);
  const sealed = assertRiskAccountRecordSealV1(value);
  const { contentDigest, ...body } = sealed;
  void contentDigest;
  envelopeBodySchema.parse(body);
  return sealed;
}

function bindingFromReceipt(receipt: LiveCapitalEnvelopeReceiptV2): LiveCapitalBasisBindingV2 {
  return sealRiskAccountRecordV1({
    schemaVersion: LIVE_CAPITAL_BASIS_BINDING_V1,
    organizationId: receipt.organizationId,
    accountId: receipt.accountId,
    policyDigest: receipt.policyDigest,
    releaseSha: receipt.releaseSha,
    envelopeDigest: receipt.contentDigest,
    capitalNotional: receipt.capitalNotional,
    lossLimitNotional: receipt.lossLimitNotional,
    validFromUtc: receipt.validFromUtc,
    validUntilUtc: receipt.validUntilUtc,
  });
}

export type LiveCapitalPublicationV2 =
  | { decision: "REFUSED"; reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" }
  | {
      decision: "REFUSED";
      reason:
        | "LIVE_CAPITAL_ENVELOPE_STALE"
        | "LIVE_CAPITAL_IDENTITY_CHANGED"
        | "EXTERNAL_ORGANIZATION"
        | "SOURCE_METHOD_UNQUALIFIED";
      basisDigest: null;
      allowanceId: null;
      orderId: null;
    }
  | {
      decision: "PUBLISHED";
      envelopeDigest: string;
      basisDigest: string;
      allowanceId: null;
      orderId: null;
    };

/**
 * Window, identity, and the explicit human source-method flag.
 * A missing flag, false, or any non-true value stays closed after the window
 * checks. Nothing in this function turns the flag on. A legacy sealed body
 * that does not carry the flag cannot size orders.
 */
export function decideLiveCapitalEnvelopeWindowV2(input: { liveCapitalEnvelope: null }): {
  decision: "REFUSED";
  reason: "LIVE_CAPITAL_ENVELOPE_ABSENT";
};
export function decideLiveCapitalEnvelopeWindowV2(input: {
  liveCapitalEnvelope: LiveCapitalEnvelopeReceiptV2;
  bound: LiveCapitalEnvelopeBoundV2;
  sourceMethodQualified: boolean;
}): LiveCapitalPublicationV2;
export function decideLiveCapitalEnvelopeWindowV2(input: {
  liveCapitalEnvelope: LiveCapitalEnvelopeReceiptV2 | null;
  bound?: LiveCapitalEnvelopeBoundV2;
  sourceMethodQualified?: boolean;
}): LiveCapitalPublicationV2 {
  if (input.liveCapitalEnvelope === null)
    return { decision: "REFUSED", reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" };
  if (!input.bound) refuse("ENVELOPE_UNBOUND");
  const receipt = assertLiveCapitalEnvelopeReceiptV2(input.liveCapitalEnvelope);
  const bound = input.bound;
  riskAccountTimeSchemaV1.parse(bound.nowUtc);
  if (receipt.organizationId !== bound.organizationId) {
    return {
      decision: "REFUSED",
      reason: "EXTERNAL_ORGANIZATION",
      basisDigest: null,
      allowanceId: null,
      orderId: null,
    };
  }
  if (
    receipt.accountId !== bound.accountId ||
    receipt.policyDigest !== bound.policyDigest ||
    receipt.releaseSha !== bound.releaseSha
  ) {
    return {
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_IDENTITY_CHANGED",
      basisDigest: null,
      allowanceId: null,
      orderId: null,
    };
  }
  const now = Date.parse(bound.nowUtc);
  if (now < Date.parse(receipt.validFromUtc) || now >= Date.parse(receipt.validUntilUtc)) {
    return {
      decision: "REFUSED",
      reason: "LIVE_CAPITAL_ENVELOPE_STALE",
      basisDigest: null,
      allowanceId: null,
      orderId: null,
    };
  }
  if (input.sourceMethodQualified !== true) {
    return {
      decision: "REFUSED",
      reason: "SOURCE_METHOD_UNQUALIFIED",
      basisDigest: null,
      allowanceId: null,
      orderId: null,
    };
  }
  const basis = bindingFromReceipt(receipt);
  return {
    decision: "PUBLISHED",
    envelopeDigest: receipt.contentDigest,
    basisDigest: basis.contentDigest,
    allowanceId: null,
    orderId: null,
  };
}

/** True only for an explicit stored boolean true. Absent, false, and strings stay closed. */
export function readStoredSourceMethodQualifiedV2(bodyText: string | null | undefined): boolean {
  if (!bodyText) return false;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    return (parsed as { sourceMethodQualified?: unknown }).sourceMethodQualified === true;
  } catch {
    return false;
  }
}

/**
 * Basis publication. `sourceMethodQualified` must be the explicit human decision.
 * A missing flag, false, or any non-true value stays closed. Nothing in this
 * function turns the flag on.
 */
export function decideLiveCapitalEnvelopePublicationV2(input: {
  liveCapitalEnvelope: null;
  sourceMethodQualified: boolean;
}): { decision: "REFUSED"; reason: "LIVE_CAPITAL_ENVELOPE_ABSENT" };
export function decideLiveCapitalEnvelopePublicationV2(input: {
  liveCapitalEnvelope: LiveCapitalEnvelopeReceiptV2;
  sourceMethodQualified: boolean;
  bound: LiveCapitalEnvelopeBoundV2;
}): LiveCapitalPublicationV2;
export function decideLiveCapitalEnvelopePublicationV2(input: {
  liveCapitalEnvelope: LiveCapitalEnvelopeReceiptV2 | null;
  sourceMethodQualified: boolean;
  bound?: LiveCapitalEnvelopeBoundV2;
}): LiveCapitalPublicationV2 {
  if (input.liveCapitalEnvelope === null) {
    return decideLiveCapitalEnvelopeWindowV2({ liveCapitalEnvelope: null });
  }
  if (!input.bound) refuse("ENVELOPE_UNBOUND");
  return decideLiveCapitalEnvelopeWindowV2({
    liveCapitalEnvelope: input.liveCapitalEnvelope,
    bound: input.bound,
    sourceMethodQualified: input.sourceMethodQualified === true,
  });
}

export function liveCapitalBasisBindingV2(
  receipt: LiveCapitalEnvelopeReceiptV2,
): LiveCapitalBasisBindingV2 {
  return bindingFromReceipt(assertLiveCapitalEnvelopeReceiptV2(receipt));
}

export type LiveCapitalEnvelopeCommandLimitV2 = Readonly<{
  commandId: string;
  /** Refusals and replays never spend a new basis. */
  consumeLimit: false;
  /** One INVALIDATED row. Expiry, or a refusal of the command that already owns current. */
  writeTerminal: boolean;
  /** Only that same commandId may drop the current pointer. */
  clearOwnedCurrent: boolean;
  /** A commandId that already has a terminal row is not written again. */
  idempotentClosed: boolean;
}>;

/**
 * Binds a refusal to commandId.
 * The account limit is the current pointer plus one basis. An invalid command
 * does not spend that limit and does not freeze its commandId, unless the
 * window is already expired. A different commandId cannot clear current.
 * A repeated commandId does not insert a second terminal row.
 */
export function liveCapitalEnvelopeCommandLimitV2(input: {
  commandId: string;
  currentCommandId: string | null;
  alreadyInvalidated: boolean;
  alreadyPublished: boolean;
  refusalReason: string;
}): LiveCapitalEnvelopeCommandLimitV2 {
  const ownsCurrent =
    input.currentCommandId !== null && input.currentCommandId === input.commandId;
  const bound = { commandId: input.commandId, consumeLimit: false as const };
  // A commandId that already published, or that already has its one terminal row,
  // cannot spend a second basis and cannot be frozen again.
  if (input.alreadyInvalidated || input.alreadyPublished) {
    return {
      ...bound,
      writeTerminal: false,
      clearOwnedCurrent: false,
      idempotentClosed: true,
    };
  }
  const stale = input.refusalReason === "LIVE_CAPITAL_ENVELOPE_STALE";
  if (!ownsCurrent && !stale) {
    return {
      ...bound,
      writeTerminal: false,
      clearOwnedCurrent: false,
      idempotentClosed: false,
    };
  }
  return {
    ...bound,
    writeTerminal: true,
    clearOwnedCurrent: ownsCurrent,
    idempotentClosed: false,
  };
}
