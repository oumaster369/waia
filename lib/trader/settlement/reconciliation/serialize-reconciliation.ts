import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/waia-core/payments/canonical-json";
import { ReconciliationDigestMismatchError } from "@/lib/trader/settlement/reconciliation/reconciliation.errors";
import {
  RECONCILIATION_EVENT_SCHEMA_VERSION,
  type ReconciliationEventPayloadInput,
  type ReconciliationEventRecordPayload,
  type ReconciliationEventRecordView,
} from "@/lib/trader/settlement/reconciliation/reconciliation.types";

export type ReconciliationEventDigestInput = ReconciliationEventPayloadInput;

export function computeReconciliationEventDigest(input: ReconciliationEventDigestInput): string {
  const canonical = {
    schemaVersion: RECONCILIATION_EVENT_SCHEMA_VERSION,
    ...input,
  };
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildReconciliationEventPayload(
  input: ReconciliationEventDigestInput,
): ReconciliationEventRecordPayload {
  const recordContentDigest = computeReconciliationEventDigest(input);
  return {
    schemaVersion: RECONCILIATION_EVENT_SCHEMA_VERSION,
    ...input,
    recordContentDigest,
  };
}

export function verifyReconciliationEventDigest(
  payload: ReconciliationEventRecordPayload | ReconciliationEventRecordView,
): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    id: _id,
    createdAt: _createdAt,
    ...digestInput
  } = payload as ReconciliationEventRecordPayload & { id?: string; createdAt?: Date };
  const expected = computeReconciliationEventDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new ReconciliationDigestMismatchError();
  }
}
