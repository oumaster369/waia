import { createHash } from "node:crypto";

import type { ReasoningContextBody } from "@/lib/trader/research/reasoning-context.types";
import { canonicalJsonString } from "@/lib/trader/research/serialize-research-evidence-export";

export function computeReasoningContextDigest(contextBody: ReasoningContextBody): string {
  return createHash("sha256").update(canonicalJsonString(contextBody), "utf8").digest("hex");
}

export function serializeReasoningContext(context: {
  schemaVersion: string;
  envelope: Record<string, unknown>;
  contextBody: ReasoningContextBody;
}): string {
  return `${JSON.stringify(context, null, 2)}\n`;
}
