import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { serializeEvolutionCycleMvp } from "@/lib/trader/research/serialize-evolution-cycle-mvp";
import { serializeResearchRejectionRecord } from "@/lib/trader/research/serialize-research-rejection-record";

export type VaultArtifactNaming = "track" | "flat";

export type WriteCampaignFailureVaultArtifactsInput = {
  vaultDir: string;
  trackId?: "A" | "B";
  naming?: VaultArtifactNaming;
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
  const naming = input.naming ?? "track";
  const rejectionRecordPath =
    naming === "flat"
      ? resolve(input.vaultDir, "research-rejection-record.json")
      : resolve(
          input.vaultDir,
          `track-${(input.trackId ?? "A").toLowerCase()}-research-rejection-record.json`,
        );
  const evolutionCyclePath =
    naming === "flat"
      ? resolve(input.vaultDir, "evolution-cycle-mvp.json")
      : resolve(
          input.vaultDir,
          `track-${(input.trackId ?? "A").toLowerCase()}-evolution-cycle-mvp.json`,
        );

  mkdirSync(input.vaultDir, { recursive: true });

  writeFileSync(
    rejectionRecordPath,
    serializeResearchRejectionRecord(input.rejectionRecord),
    "utf8",
  );
  writeFileSync(evolutionCyclePath, serializeEvolutionCycleMvp(input.evolutionCycle), "utf8");

  return { rejectionRecordPath, evolutionCyclePath };
}
