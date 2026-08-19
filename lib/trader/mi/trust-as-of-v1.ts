import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  evaluatePitChronologyV1,
  type PitChronologyUnknownReasonV1,
  type PitChronologyV1,
} from "@/lib/trader/mi/pit-chronology-v1";

export const TRUST_AS_OF_RECEIPT_V1_SCHEMA_VERSION = "trust-as-of-receipt-v1" as const;

const HEX_64 = /^[0-9a-f]{64}$/;
const FUTURE_REASONS = new Set<PitChronologyUnknownReasonV1>([
  "EVENT_TIME_AFTER_ANCHOR",
  "AVAILABLE_AT_AFTER_ANCHOR",
  "INGEST_TIME_AFTER_ANCHOR",
]);

export type TrustAsOfRevisionV1 = {
  id: string;
  organizationId: string;
  sourceId: string;
  trustScore: string;
  contentDigest: string;
  revisionOf: string | null;
  revisionSeq: number;
  chronology: PitChronologyV1;
};

export type TrustAsOfUnknownReasonV1 =
  | PitChronologyUnknownReasonV1
  | "NO_TRUST_HISTORY"
  | "FUTURE_ONLY"
  | "SCOPE_MISMATCH"
  | "INVALID_REVISION_ID"
  | "DUPLICATE_REVISION_ID"
  | "INVALID_REVISION_SEQUENCE"
  | "INVALID_REVISION_DIGEST"
  | "DUPLICATE_REVISION_SEQUENCE"
  | "INCOMPLETE_VISIBLE_PREFIX"
  | "INVALID_ROOT_REVISION"
  | "BROKEN_PREDECESSOR_LINK";

export type TrustAsOfVisibleRevisionV1 = {
  id: string;
  revisionSeq: number;
  revisionOf: string | null;
  contentDigest: string;
  trustScore: string;
  eventTimeUtc: string;
  availableAtUtc: string;
  ingestTimeUtc: string;
};

export type TrustAsOfReceiptV1 = {
  id: string;
  schemaVersion: typeof TRUST_AS_OF_RECEIPT_V1_SCHEMA_VERSION;
  organizationId: string;
  sourceId: string;
  anchorTimeUtc: string;
  status: "RESOLVED" | "UNKNOWN";
  unknownReason: TrustAsOfUnknownReasonV1 | null;
  selectedTrustRevisionId: string | null;
  selectedRevisionSeq: number | null;
  selectedContentDigest: string | null;
  selectedTrustScore: string | null;
  visiblePrefix: TrustAsOfVisibleRevisionV1[];
  visiblePrefixDigest: string;
  contentDigest: string;
};

type ReceiptBody = Omit<TrustAsOfReceiptV1, "id" | "contentDigest">;
function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}
function stableRevisionOrder(a: TrustAsOfRevisionV1, b: TrustAsOfRevisionV1): number {
  if (a.revisionSeq !== b.revisionSeq) return a.revisionSeq < b.revisionSeq ? -1 : 1;
  if (a.contentDigest !== b.contentDigest) return a.contentDigest < b.contentDigest ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
function finalizeReceipt(body: ReceiptBody): TrustAsOfReceiptV1 {
  const contentDigest = sha256Canonical(body);
  return { ...body, id: contentDigest, contentDigest };
}
function unknownReceipt(
  base: Pick<ReceiptBody, "organizationId" | "sourceId" | "anchorTimeUtc">,
  reason: TrustAsOfUnknownReasonV1,
  visiblePrefix: TrustAsOfVisibleRevisionV1[],
): TrustAsOfReceiptV1 {
  const visiblePrefixDigest = sha256Canonical(visiblePrefix);
  return finalizeReceipt({
    schemaVersion: TRUST_AS_OF_RECEIPT_V1_SCHEMA_VERSION,
    ...base,
    status: "UNKNOWN",
    unknownReason: reason,
    selectedTrustRevisionId: null,
    selectedRevisionSeq: null,
    selectedContentDigest: null,
    selectedTrustScore: null,
    visiblePrefix,
    visiblePrefixDigest,
  });
}

/**
 * Pure, input-order-independent resolution. Future rows are excluded from prior identity;
 * visible chain ambiguity fails closed instead of falling back to an older revision.
 */
export function resolveTrustAsOfV1(input: {
  organizationId: string;
  sourceId: string;
  anchorTime: Date;
  history: TrustAsOfRevisionV1[];
}): TrustAsOfReceiptV1 {
  if (!(input.anchorTime instanceof Date) || !Number.isFinite(input.anchorTime.getTime())) {
    return unknownReceipt(
      { organizationId: input.organizationId, sourceId: input.sourceId, anchorTimeUtc: "INVALID" },
      "INVALID_ANCHOR_TIME",
      [],
    );
  }

  const base = {
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    anchorTimeUtc: input.anchorTime.toISOString(),
  };
  if (input.history.length === 0) return unknownReceipt(base, "NO_TRUST_HISTORY", []);
  if (input.history.some((revision) =>
    revision.organizationId !== input.organizationId || revision.sourceId !== input.sourceId
  )) return unknownReceipt(base, "SCOPE_MISMATCH", []);
  if (input.history.some((revision) => typeof revision.id !== "string" || revision.id.length === 0)) {
    return unknownReceipt(base, "INVALID_REVISION_ID", []);
  }
  if (new Set(input.history.map((revision) => revision.id)).size !== input.history.length) {
    return unknownReceipt(base, "DUPLICATE_REVISION_ID", []);
  }
  if (input.history.some((revision) =>
    !Number.isSafeInteger(revision.revisionSeq) || revision.revisionSeq < 1
  )) return unknownReceipt(base, "INVALID_REVISION_SEQUENCE", []);
  if (input.history.some((revision) =>
    typeof revision.contentDigest !== "string" || !HEX_64.test(revision.contentDigest)
  )) return unknownReceipt(base, "INVALID_REVISION_DIGEST", []);

  const ordered = [...input.history].sort(stableRevisionOrder);
  const visible: TrustAsOfVisibleRevisionV1[] = [];
  const chronologyFailures: PitChronologyUnknownReasonV1[] = [];
  for (const revision of ordered) {
    const chronology = evaluatePitChronologyV1(revision.chronology, input.anchorTime);
    if (chronology.status === "UNKNOWN") {
      chronologyFailures.push(chronology.reason);
      continue;
    }
    visible.push({
      id: revision.id,
      revisionSeq: revision.revisionSeq,
      revisionOf: revision.revisionOf,
      contentDigest: revision.contentDigest,
      trustScore: revision.trustScore,
      eventTimeUtc: chronology.chronology.eventTimeUtc,
      availableAtUtc: chronology.chronology.availableAtUtc,
      ingestTimeUtc: chronology.chronology.ingestTimeUtc,
    });
  }

  const nonFutureFailure = chronologyFailures.find((reason) => !FUTURE_REASONS.has(reason));
  if (nonFutureFailure) return unknownReceipt(base, nonFutureFailure, visible);
  if (visible.length === 0) return unknownReceipt(base, "FUTURE_ONLY", []);
  for (let index = 1; index < visible.length; index += 1) {
    if (visible[index]!.revisionSeq === visible[index - 1]!.revisionSeq) {
      return unknownReceipt(base, "DUPLICATE_REVISION_SEQUENCE", visible);
    }
  }
  if (visible[0]!.revisionSeq !== 1) return unknownReceipt(base, "INCOMPLETE_VISIBLE_PREFIX", visible);
  if (visible[0]!.revisionOf !== null) return unknownReceipt(base, "INVALID_ROOT_REVISION", visible);
  for (let index = 1; index < visible.length; index += 1) {
    const previous = visible[index - 1]!;
    const current = visible[index]!;
    if (current.revisionSeq !== previous.revisionSeq + 1) return unknownReceipt(base, "INCOMPLETE_VISIBLE_PREFIX", visible);
    if (current.revisionOf !== previous.id) return unknownReceipt(base, "BROKEN_PREDECESSOR_LINK", visible);
  }

  const selected = visible[visible.length - 1]!;
  const visiblePrefixDigest = sha256Canonical(visible);
  return finalizeReceipt({
    schemaVersion: TRUST_AS_OF_RECEIPT_V1_SCHEMA_VERSION,
    ...base,
    status: "RESOLVED",
    unknownReason: null,
    selectedTrustRevisionId: selected.id,
    selectedRevisionSeq: selected.revisionSeq,
    selectedContentDigest: selected.contentDigest,
    selectedTrustScore: selected.trustScore,
    visiblePrefix: visible,
    visiblePrefixDigest,
  });
}

export function serializeTrustAsOfReceiptV1(receipt: TrustAsOfReceiptV1): string {
  return canonicalJsonString(receipt);
}

export function isTrustAsOfReceiptV1ContentAddressed(receipt: TrustAsOfReceiptV1): boolean {
  const { id, contentDigest, ...body } = receipt;
  return (
    id === contentDigest &&
    HEX_64.test(contentDigest) &&
    sha256Canonical(body) === contentDigest
  );
}
