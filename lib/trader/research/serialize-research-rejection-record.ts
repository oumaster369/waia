import { createHash } from "node:crypto";

import type { ResearchRejectionRecordBody } from "@/lib/trader/research/research-rejection-record.types";
import { canonicalJsonString } from "@/lib/trader/research/serialize-research-evidence-export";

export function computeResearchRejectionRecordDigest(
  recordBody: ResearchRejectionRecordBody,
): string {
  return createHash("sha256").update(canonicalJsonString(recordBody), "utf8").digest("hex");
}

export function serializeResearchRejectionRecord(record: {
  schemaVersion: string;
  envelope: { contentDigest: string };
  recordBody: ResearchRejectionRecordBody;
}): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
