/**
 * DEE-436 — root RESUME enforcement CLI (invoked by fhv-t4-resume-campaign-root.sh).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import {
  readFhvCommandLedgerEntries,
  readFhvCommandResult,
} from "@/lib/trader/observability/fhv-command-ledger";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";
import {
  FHV_T4_PAUSED_PROOF_CLASSIFICATION,
  readFhvT4PausedVerificationProof,
} from "@/lib/trader/observability/fhv-t4-paused-final-proofs";
import {
  serializeFhvT4ResumeEnforcementProof,
  type FhvT4ResumeEnforcementProofV1,
} from "@/lib/trader/observability/fhv-t4-resume-enforcement-proof";

export class FhvT4ResumeCampaignRootError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ResumeCampaignRootError";
  }
}

function parseFlag(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1]?.trim();
}

function systemctlShow(systemctlBin: string, unit: string, field: string): string {
  return execFileSync(systemctlBin, ["show", unit, "-p", field, "--value"], {
    encoding: "utf8",
  }).trim();
}

export function enforceFhvT4ResumeCampaignRoot(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  systemctlBin: string;
  unitName?: string;
}): FhvT4ResumeEnforcementProofV1 {
  const unit = input.unitName ?? "waia-fhv-campaign.service";
  const targetSha = input.targetSha.trim().toLowerCase();
  const pausedProof = readFhvT4PausedVerificationProof(input.runRoot);
  if (!pausedProof || pausedProof.classification !== FHV_T4_PAUSED_PROOF_CLASSIFICATION) {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_PAUSED_PROOF_MISSING",
      "Paused verification proof required before root RESUME enforcement.",
    );
  }

  const resumeEntries = readFhvCommandLedgerEntries(input.runRoot).filter(
    (entry) => entry.command.action === "RESUME_FROM_CHECKPOINT",
  );
  if (resumeEntries.length === 0) {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_LEDGER_MISSING",
      "RESUME ledger entry missing.",
    );
  }
  const resumeEntry = resumeEntries[resumeEntries.length - 1]!;
  const result = readFhvCommandResult(input.runRoot, resumeEntry.command.commandId);
  if (!result) {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_RESULT_MISSING",
      "RESUME command result missing.",
    );
  }
  if (result.status !== "accepted") {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_NOT_ACCEPTED",
      `RESUME result status must be accepted, got ${result.status}.`,
    );
  }
  if (
    resumeEntry.command.campaignRunId !== input.runId ||
    resumeEntry.command.organizationId !== input.organizationId
  ) {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_IDENTITY_MISMATCH",
      "RESUME ledger identity mismatch.",
    );
  }

  const checkpoint = readReplayCheckpoint(input.runRoot);
  if (
    !checkpoint ||
    resumeEntry.command.expectedCampaignState.checkpointSeq !== FHV_REHEARSAL_CHECKPOINT_CYCLE
  ) {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_CHECKPOINT_MISMATCH",
      "RESUME checkpoint identity mismatch.",
    );
  }

  const activeState = systemctlShow(input.systemctlBin, unit, "ActiveState");
  if (activeState === "active" || activeState === "activating") {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_CAMPAIGN_ACTIVE",
      "Campaign unit must be inactive before root RESUME enforcement.",
    );
  }

  const previousInvocationId = systemctlShow(input.systemctlBin, unit, "InvocationID");
  const bootId = normalizeFhvT4BootId(readFileSync("/proc/sys/kernel/random/boot_id", "utf8"));

  execFileSync(input.systemctlBin, ["start", unit], { stdio: "pipe" });

  const newInvocationId = systemctlShow(input.systemctlBin, unit, "InvocationID");
  if (!newInvocationId || newInvocationId === previousInvocationId) {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_INVOCATION_UNCHANGED",
      "Campaign InvocationID must change after root start.",
    );
  }

  const execMainPid = Number(systemctlShow(input.systemctlBin, unit, "ExecMainPID"));
  if (!Number.isInteger(execMainPid) || execMainPid <= 0) {
    throw new FhvT4ResumeCampaignRootError(
      "FHV_T4_RESUME_ENFORCEMENT_PID_INVALID",
      "ExecMainPID invalid after root start.",
    );
  }

  const proof = serializeFhvT4ResumeEnforcementProof({
    schemaVersion: "fhv-t4-resume-enforcement-proof/v1",
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha,
    resumeCommandId: resumeEntry.command.commandId,
    resumeIdempotencyKey: resumeEntry.command.idempotencyKey,
    bootId,
    campaignUnitName: unit,
    previousInvocationId,
    newInvocationId,
    execMainPid,
    execMainStartTimestampMonotonic: systemctlShow(
      input.systemctlBin,
      unit,
      "ExecMainStartTimestampMonotonic",
    ),
    nRestarts: Number(systemctlShow(input.systemctlBin, unit, "NRestarts")),
    enforcedAtUtc: new Date().toISOString(),
  });

  return proof;
}

function main(): void {
  const argv = process.argv.slice(2);
  const runRoot = parseFlag(argv, "--run-root");
  const runId = parseFlag(argv, "--run-id");
  const organizationId = parseFlag(argv, "--organization-id");
  const targetSha = parseFlag(argv, "--target-sha");
  const systemctlBin = parseFlag(argv, "--systemctl-bin");
  const output = parseFlag(argv, "--output");
  if (!runRoot || !runId || !organizationId || !targetSha || !systemctlBin || !output) {
    console.error("Missing required flags.");
    process.exit(2);
  }
  const proof = enforceFhvT4ResumeCampaignRoot({
    runRoot,
    runId,
    organizationId,
    targetSha,
    systemctlBin,
  });
  writeFileAtomic(output, `${JSON.stringify(proof, null, 2)}\n`);
}

if (process.env.WAIA_TRADER_CLI === "1" || import.meta.url.endsWith(process.argv[1] ?? "")) {
  main();
}

export { main as runFhvT4ResumeCampaignRootCli };
