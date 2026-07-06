import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { CampaignOperatorDiagnostics } from "@/lib/trader/research/campaign-operator-diagnostics.types";
import { serializeCampaignOperatorDiagnostics } from "@/lib/trader/research/build-campaign-operator-diagnostics";
import type { EvolutionCycleMvp } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { serializeEvolutionCycleMvp } from "@/lib/trader/research/serialize-evolution-cycle-mvp";
import { serializeResearchRejectionRecord } from "@/lib/trader/research/serialize-research-rejection-record";

export type VaultArtifactNaming = "track" | "flat";

export type WriteCampaignFailureVaultArtifactsInput = {
  vaultDir: string;
  trackId?: "A" | "B";
  naming?: VaultArtifactNaming;
  rejectionBasename?: string;
  evolutionBasename?: string;
  diagnosticsBasename?: string;
  rejectionRecord: ResearchRejectionRecord;
  evolutionCycle: EvolutionCycleMvp;
  operatorDiagnostics?: CampaignOperatorDiagnostics;
};

export type WriteCampaignFailureVaultArtifactsResult = {
  rejectionRecordPath: string;
  evolutionCyclePath: string;
  operatorDiagnosticsPath: string | null;
};

export function writeCampaignFailureVaultArtifacts(
  input: WriteCampaignFailureVaultArtifactsInput,
): WriteCampaignFailureVaultArtifactsResult {
  const naming = input.naming ?? "track";
  const rejectionRecordPath =
    naming === "flat"
      ? resolve(input.vaultDir, input.rejectionBasename ?? "research-rejection-record.json")
      : resolve(
          input.vaultDir,
          `track-${(input.trackId ?? "A").toLowerCase()}-research-rejection-record.json`,
        );
  const evolutionCyclePath =
    naming === "flat"
      ? resolve(input.vaultDir, input.evolutionBasename ?? "evolution-cycle-mvp.json")
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

  let operatorDiagnosticsPath: string | null = null;
  if (input.operatorDiagnostics) {
    operatorDiagnosticsPath =
      naming === "flat"
        ? resolve(input.vaultDir, input.diagnosticsBasename ?? "campaign-operator-diagnostics.json")
        : resolve(
            input.vaultDir,
            `track-${(input.trackId ?? "A").toLowerCase()}-campaign-operator-diagnostics.json`,
          );
    writeFileSync(
      operatorDiagnosticsPath,
      serializeCampaignOperatorDiagnostics(input.operatorDiagnostics),
      "utf8",
    );
  }

  return { rejectionRecordPath, evolutionCyclePath, operatorDiagnosticsPath };
}
