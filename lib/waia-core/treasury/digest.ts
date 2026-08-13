import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/waia-core/payments/canonical-json";

export function computeTreasuryContentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}
