import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { serializeEvolutionCycleMvp } from "@/lib/trader/research/serialize-evolution-cycle-mvp";
import { serializeResearchRejectionRecord } from "@/lib/trader/research/serialize-research-rejection-record";

export type WriteCampaignFailureVaultArtifactsInput = {
  vaultDir: string;
  trackId: "A" | "B";
  rejectionRecord: ResearchRejectionRecord;
  evolutionCycle: EvolutionCycleMvp;
};

export type WriteCampaignFailureVaultArtifactsResult = {
  rejectionRecordPath: string;
  evolutionCyclePath: string;
};

export function writeCampaignFailureVaultArtifacts(
  input: WriteCampaignFailureVaultArtifactsInput,
): WriteCampaignFailureVaultArtifactsResult {
  const trackSuffix = input.trackId.toLowerCase();
  const rejectionRecordPath = resolve(
    input.vaultDir,
    `track-${trackSuffix}-research-rejection-record.json`,
  );
  const evolutionCyclePath = resolve(
    input.vaultDir,
    `track-${trackSuffix}-evolution-cycle-mvp.json`,
  );

  writeFileSync(
    rejectionRecordPath,
    serializeResearchRejectionRecord(input.rejectionRecord),
    "utf8",
  );
  writeFileSync(evolutionCyclePath, serializeEvolutionCycleMvp(input.evolutionCycle), "utf8");

  return { rejectionRecordPath, evolutionCyclePath };
}
