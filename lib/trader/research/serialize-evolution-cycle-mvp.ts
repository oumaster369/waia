import { createHash } from "node:crypto";

import type { EvolutionCycleMvpBody } from "@/lib/trader/research/evolution-cycle-mvp.types";
import { canonicalJsonString } from "@/lib/trader/research/serialize-research-evidence-export";

export function computeEvolutionCycleMvpDigest(cycleBody: EvolutionCycleMvpBody): string {
  return createHash("sha256").update(canonicalJsonString(cycleBody), "utf8").digest("hex");
}

export function serializeEvolutionCycleMvp(cycle: {
  schemaVersion: string;
  envelope: { contentDigest: string } & Record<string, unknown>;
  cycleBody: EvolutionCycleMvpBody;
}): string {
  return `${JSON.stringify(cycle, null, 2)}\n`;
}
