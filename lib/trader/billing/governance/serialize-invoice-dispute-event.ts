import { createHash } from "node:crypto";

import { InvoiceDisputeEventDigestMismatchError } from "@/lib/trader/billing/governance/billing-governance.errors";
import {
  INVOICE_DISPUTE_EVENT_SCHEMA_VERSION,
  type InvoiceDisputeEventRecordPayload,
  type InvoiceDisputeEventRecordView,
} from "@/lib/trader/billing/governance/billing-governance.types";
import { canonicalJsonString } from "@/lib/waia-core/payments/canonical-json";

export type InvoiceDisputeEventDigestInput = Omit<
  InvoiceDisputeEventRecordPayload,
  "recordContentDigest" | "schemaVersion"
>;

export function computeInvoiceDisputeEventDigest(input: InvoiceDisputeEventDigestInput): string {
  const canonical = {
    schemaVersion: INVOICE_DISPUTE_EVENT_SCHEMA_VERSION,
    ...input,
  };
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildInvoiceDisputeEventPayload(
  input: InvoiceDisputeEventDigestInput,
): InvoiceDisputeEventRecordPayload {
  const recordContentDigest = computeInvoiceDisputeEventDigest(input);
  return {
    schemaVersion: INVOICE_DISPUTE_EVENT_SCHEMA_VERSION,
    ...input,
    recordContentDigest,
  };
}

export function verifyInvoiceDisputeEventDigest(
  payload: InvoiceDisputeEventRecordPayload | InvoiceDisputeEventRecordView,
): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    id: _id,
    createdAt: _createdAt,
    ...digestInput
  } = payload as InvoiceDisputeEventRecordPayload & { id?: string; createdAt?: Date };
  const expected = computeInvoiceDisputeEventDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new InvoiceDisputeEventDigestMismatchError();
  }
}
