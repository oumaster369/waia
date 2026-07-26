/**
 * DEE-436 — T4A campaign CLI exit classification (host-monotonic contract).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import { readFhvRehearsalTerminalClassification } from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  readFhvT4CampaignRuntimeProof,
  readFhvT4CampaignRuntimeStart,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import {
  FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS,
  readFhvT4HostMonotonicSample,
} from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";

export class FhvT4CampaignCliVerdictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4CampaignCliVerdictError";
  }
}

function assertSharedMonotonicBudget(input: { runRoot: string; repoRoot: string }): {
  elapsedMs: number;
  hostBootId: string;
} {
  const start = readFhvT4CampaignRuntimeStart(input.runRoot);
  if (!start) {
    throw new FhvT4CampaignCliVerdictError(
      "FHV_T4_CAMPAIGN_RUNTIME_START_MISSING",
      "Campaign runtime start marker is required.",
    );
  }
  const sample = readFhvT4HostMonotonicSample(input.repoRoot);
  if (sample.bootId !== start.hostBootId) {
    throw new FhvT4CampaignCliVerdictError(
      "FHV_T4_CAMPAIGN_RUNTIME_BOOT_ID_CHANGED",
      "Host boot ID changed during campaign runtime.",
    );
  }
  const startedNs = BigInt(start.startedMonotonicNs);
  const currentNs = BigInt(sample.monotonicNs);
  if (currentNs < startedNs) {
    throw new FhvT4CampaignCliVerdictError(
      "FHV_T4_CAMPAIGN_RUNTIME_MONOTONIC_REGRESSION",
      "Current monotonic sample regressed before start marker.",
    );
  }
  const elapsedMs = Number((currentNs - startedNs) / 1_000_000n);
  if (elapsedMs > FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS) {
    throw new FhvT4CampaignCliVerdictError(
      "FHV_T4_CAMPAIGN_RUNTIME_BUDGET_EXCEEDED",
      "Shared host-monotonic budget exceeded.",
    );
  }
  return { elapsedMs, hostBootId: start.hostBootId };
}

export function classifyFhvT4CampaignCliExit(input: {
  classification: string;
  t4Deterministic: boolean;
  runRoot: string;
  repoRoot: string;
  wallClockStartedAtMs: number;
  maxRuntimeMs: number;
}): { exitCode: number; reason?: string } {
  try {
    if (input.classification === "REHEARSAL_PAUSED") {
      if (input.t4Deterministic) {
        assertSharedMonotonicBudget({ runRoot: input.runRoot, repoRoot: input.repoRoot });
        const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
        if (terminal !== "REHEARSAL_PAUSED") {
          throw new FhvT4CampaignCliVerdictError(
            "FHV_T4_CONTROLLED_PAUSE_TERMINAL_INVALID",
            "Controlled pause requires REHEARSAL_PAUSED terminal.",
          );
        }
        const terminalPath = join(input.runRoot, "fhv-rehearsal-terminal.v1.json");
        const terminalJson = JSON.parse(readFileSync(terminalPath, "utf8")) as {
          actualPauseCycle?: number;
        };
        if (terminalJson.actualPauseCycle !== FHV_REHEARSAL_CHECKPOINT_CYCLE) {
          throw new FhvT4CampaignCliVerdictError(
            "FHV_T4_CONTROLLED_PAUSE_CYCLE_INVALID",
            `Controlled pause requires cycle ${FHV_REHEARSAL_CHECKPOINT_CYCLE}.`,
          );
        }
        if (readFhvT4CampaignRuntimeProof(input.runRoot)) {
          throw new FhvT4CampaignCliVerdictError(
            "FHV_T4_CONTROLLED_PAUSE_FINAL_PROOF_PRESENT",
            "Controlled pause must not require final runtime proof.",
          );
        }
        return { exitCode: 0 };
      }
      const wallElapsedMs = Date.now() - input.wallClockStartedAtMs;
      if (wallElapsedMs > input.maxRuntimeMs) {
        return { exitCode: 1, reason: "REHEARSAL_TIMEOUT" };
      }
      return { exitCode: 0 };
    }

    if (input.classification === "REHEARSAL_OK") {
      if (input.t4Deterministic) {
        assertSharedMonotonicBudget({ runRoot: input.runRoot, repoRoot: input.repoRoot });
        const runtime = readFhvT4CampaignRuntimeProof(input.runRoot);
        if (!runtime) {
          throw new FhvT4CampaignCliVerdictError(
            "FHV_T4_CAMPAIGN_RUNTIME_MISSING",
            "Final runtime proof is required for REHEARSAL_OK.",
          );
        }
        const elapsedMs = Number(BigInt(runtime.elapsedMonotonicNs) / 1_000_000n);
        if (elapsedMs > FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS) {
          throw new FhvT4CampaignCliVerdictError(
            "FHV_T4_CAMPAIGN_RUNTIME_BUDGET_EXCEEDED",
            "Final runtime proof exceeded shared budget.",
          );
        }
        return { exitCode: 0 };
      }
      const wallElapsedMs = Date.now() - input.wallClockStartedAtMs;
      if (wallElapsedMs > input.maxRuntimeMs) {
        return { exitCode: 1, reason: "REHEARSAL_TIMEOUT" };
      }
      return { exitCode: 0 };
    }

    return { exitCode: 1, reason: "REHEARSAL_FAILED" };
  } catch (error) {
    const code =
      error instanceof FhvT4CampaignCliVerdictError
        ? error.code
        : error instanceof Error
          ? error.name
          : "FHV_T4_CAMPAIGN_CLI_VERDICT_FAILED";
    return { exitCode: 1, reason: code };
  }
}
