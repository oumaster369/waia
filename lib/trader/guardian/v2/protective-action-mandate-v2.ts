import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const PROTECTIVE_ACTION_MANDATE_V2_SCHEMA_VERSION =
  "waia.trader.protective_action_mandate.v2" as const;

export const protectiveActionKindV2Values = [
  "REDUCE_PARTIAL",
  "CLOSE_FULL",
  "TIGHTEN_PROTECTION",
] as const;
export type ProtectiveActionKindV2 = (typeof protectiveActionKindV2Values)[number];

export type ProtectiveActionMandateV2 = Readonly<{
  schemaVersion: typeof PROTECTIVE_ACTION_MANDATE_V2_SCHEMA_VERSION;
  mandateId: string;
  organizationId: string;
  positionId: string;
  lotId: string;
  symbol: string;
  openingCausalLineageDigest: string;
  guardianAssessmentId: string;
  guardianAssessmentContentDigest: string;
  decisionId: string;
  decisionContentDigest: string;
  actionKind: ProtectiveActionKindV2;
  maximumReductionBps: number;
  deterministicTriggerSpecDigest: string;
  validUntilUtc: string;
  contentDigest: string;
}>;

export type ProtectiveActionMandateV2Draft = Omit<
  ProtectiveActionMandateV2,
  "schemaVersion" | "mandateId" | "contentDigest"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const KEYS = [
  "actionKind", "contentDigest", "decisionContentDigest", "decisionId",
  "deterministicTriggerSpecDigest", "guardianAssessmentContentDigest",
  "guardianAssessmentId", "lotId", "mandateId", "maximumReductionBps",
  "openingCausalLineageDigest", "organizationId", "positionId", "schemaVersion",
  "symbol", "validUntilUtc",
].sort();

function bodyDigest(body: ProtectiveActionMandateV2Draft & { schemaVersion: string }): string {
  return createHash("sha256")
    .update(canonicalizeSemanticJsonString(body), "utf8")
    .digest("hex");
}

function assertActionBounds(value: ProtectiveActionMandateV2): void {
  if (!Number.isSafeInteger(value.maximumReductionBps)) {
    throw new Error("PROTECTIVE_MANDATE_INVALID_REDUCTION");
  }
  if (
    value.actionKind === "REDUCE_PARTIAL" &&
    (value.maximumReductionBps <= 0 || value.maximumReductionBps >= 10_000)
  ) throw new Error("PROTECTIVE_MANDATE_PARTIAL_OUT_OF_RANGE");
  if (value.actionKind === "CLOSE_FULL" && value.maximumReductionBps !== 10_000) {
    throw new Error("PROTECTIVE_MANDATE_CLOSE_MUST_BE_FULL");
  }
  if (value.actionKind === "TIGHTEN_PROTECTION" && value.maximumReductionBps !== 0) {
    throw new Error("PROTECTIVE_MANDATE_TIGHTEN_MUST_NOT_CHANGE_EXPOSURE");
  }
}

export function assertProtectiveActionMandateV2(value: ProtectiveActionMandateV2): void {
  if (value.schemaVersion !== PROTECTIVE_ACTION_MANDATE_V2_SCHEMA_VERSION) {
    throw new Error("PROTECTIVE_MANDATE_UNSUPPORTED_VERSION");
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(KEYS)) {
    throw new Error("PROTECTIVE_MANDATE_UNEXPECTED_FIELD");
  }
  for (const field of [
    "organizationId", "positionId", "lotId", "symbol", "guardianAssessmentId",
    "decisionId", "validUntilUtc",
  ] as const) {
    if (!value[field]) throw new Error("PROTECTIVE_MANDATE_INCOMPLETE");
  }
  for (const field of [
    "openingCausalLineageDigest", "guardianAssessmentContentDigest",
    "decisionContentDigest", "deterministicTriggerSpecDigest", "contentDigest",
  ] as const) {
    if (!DIGEST.test(value[field])) throw new Error("PROTECTIVE_MANDATE_INVALID_DIGEST");
  }
  if (!protectiveActionKindV2Values.includes(value.actionKind)) {
    throw new Error("PROTECTIVE_MANDATE_FORBIDDEN_ACTION");
  }
  if (!Number.isFinite(Date.parse(value.validUntilUtc))) {
    throw new Error("PROTECTIVE_MANDATE_INVALID_EXPIRY");
  }
  assertActionBounds(value);
  const { mandateId, contentDigest, ...body } = value;
  const expected = bodyDigest(body);
  if (contentDigest !== expected) throw new Error("PROTECTIVE_MANDATE_DIGEST_MISMATCH");
  if (mandateId !== `protective-mandate-v2:${expected}`) {
    throw new Error("PROTECTIVE_MANDATE_ID_MISMATCH");
  }
}

export function buildProtectiveActionMandateV2(
  draft: ProtectiveActionMandateV2Draft,
): ProtectiveActionMandateV2 {
  const body = { schemaVersion: PROTECTIVE_ACTION_MANDATE_V2_SCHEMA_VERSION, ...draft };
  const contentDigest = bodyDigest(body);
  const value = Object.freeze({
    ...body,
    mandateId: `protective-mandate-v2:${contentDigest}`,
    contentDigest,
  });
  assertProtectiveActionMandateV2(value);
  return value;
}

