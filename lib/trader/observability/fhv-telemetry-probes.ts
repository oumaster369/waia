import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

const MAX_ARTIFACT_MEASURE_BYTES = 512 * 1024 * 1024;

export function measureBoundedDirectoryBytes(
  root: string,
  maxBytes = MAX_ARTIFACT_MEASURE_BYTES,
): number | null {
  if (!existsSync(root)) {
    return null;
  }
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(fullPath);
      } else if (stat.isFile()) {
        total += stat.size;
        if (total > maxBytes) {
          return maxBytes;
        }
      }
    }
  }
  return total;
}

export function resolveCheckpointWrittenAtUtc(checkpointPath: string): string | null {
  try {
    return new Date(statSync(checkpointPath).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

export function resolveCampaignTerminalState(input: {
  explicitTerminalState?: string | null;
  checkpointTerminalState?: string | null;
  campaignRunning?: boolean;
}): string {
  if (input.explicitTerminalState) {
    return input.explicitTerminalState;
  }
  if (input.checkpointTerminalState) {
    return input.checkpointTerminalState;
  }
  if (input.campaignRunning) {
    return "RUNNING";
  }
  return "UNKNOWN";
}

export function resolveBarsTotal(input: {
  pinnedBarsTotal?: number | null;
  manifestBarsTotal?: number | null;
}): number | null {
  if (typeof input.pinnedBarsTotal === "number" && input.pinnedBarsTotal > 0) {
    return input.pinnedBarsTotal;
  }
  if (typeof input.manifestBarsTotal === "number" && input.manifestBarsTotal > 0) {
    return input.manifestBarsTotal;
  }
  return null;
}

export function assertFhvStatusOrganizationBinding(
  status: FhvOperatorStatusV1,
  organizationId: string,
  expectedRunId?: string,
): void {
  if (status.campaign.organizationId !== organizationId) {
    throw new Error("FHV_STATUS_ORG_MISMATCH");
  }
  if (expectedRunId && status.campaign.runId !== expectedRunId) {
    throw new Error("FHV_STATUS_RUN_MISMATCH");
  }
}
