import { createHash } from "node:crypto";

import { InvoiceCorrectionDigestMismatchError } from "@/lib/trader/billing/governance/billing-governance.errors";
import {
  INVOICE_CORRECTION_SCHEMA_VERSION,
  type InvoiceCorrectionRecordPayload,
  type InvoiceCorrectionRecordView,
} from "@/lib/trader/billing/governance/billing-governance.types";
import { canonicalJsonString } from "@/lib/waia-core/payments/canonical-json";

export type InvoiceCorrectionDigestInput = Omit<
  InvoiceCorrectionRecordPayload,
  "recordContentDigest" | "schemaVersion"
>;

export function computeInvoiceCorrectionDigest(input: InvoiceCorrectionDigestInput): string {
  const canonical = {
    schemaVersion: INVOICE_CORRECTION_SCHEMA_VERSION,
    ...input,
  };
  return createHash("sha256").update(canonicalJsonString(canonical), "utf8").digest("hex");
}

export function buildInvoiceCorrectionPayload(
  input: InvoiceCorrectionDigestInput,
): InvoiceCorrectionRecordPayload {
  const recordContentDigest = computeInvoiceCorrectionDigest(input);
  return {
    schemaVersion: INVOICE_CORRECTION_SCHEMA_VERSION,
    ...input,
    recordContentDigest,
  };
}

export function verifyInvoiceCorrectionDigest(
  payload: InvoiceCorrectionRecordPayload | InvoiceCorrectionRecordView,
): void {
  const {
    recordContentDigest,
    schemaVersion: _schemaVersion,
    id: _id,
    createdAt: _createdAt,
    ...digestInput
  } = payload as InvoiceCorrectionRecordPayload & { id?: string; createdAt?: Date };
  const expected = computeInvoiceCorrectionDigest(digestInput);
  if (expected !== recordContentDigest) {
    throw new InvoiceCorrectionDigestMismatchError();
  }
}
