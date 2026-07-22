import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import type { FhvOperatorAction } from "@/lib/trader/observability/fhv-observability.constants";

export type FhvCampaignControlRequestV1 = Readonly<{
  schemaVersion: "fhv-campaign-control-request/v1";
  action: FhvOperatorAction;
  runId: string;
  organizationId: string;
  operatorId: string;
  reason: string;
  requestedAtUtc: string;
  status?: "pending" | "consumed";
  consumedAtUtc?: string;
}>;

function controlDir(runRoot: string): string {
  const dir = join(runRoot, "control");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeFhvCampaignControlRequest(
  runRoot: string,
  request: FhvCampaignControlRequestV1,
): string {
  const filename = `${request.action.toLowerCase()}-request.v1.json`;
  const path = join(controlDir(runRoot), filename);
  writeFileAtomic(path, `${JSON.stringify(request, null, 2)}\n`);
  return path;
}

export function consumeFhvCampaignControlRequest(
  runRoot: string,
  request: FhvCampaignControlRequestV1,
): void {
  writeFhvCampaignControlRequest(runRoot, {
    ...request,
    status: "consumed",
    consumedAtUtc: new Date().toISOString(),
  });
}
