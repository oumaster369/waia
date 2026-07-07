import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay/provider-sidecar-types";

export function computeSidecarContentDigest(sidecar: ReplayProviderSidecar): string {
  return createHash("sha256").update(canonicalJsonString(sidecar), "utf8").digest("hex");
}
