import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export function adminRevision(data: unknown): string {
  return createHash("sha256").update(canonicalizeSemanticJsonString(data)).digest("hex");
}
