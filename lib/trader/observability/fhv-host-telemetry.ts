import os from "node:os";

import { evaluateDiskThresholds } from "@/lib/trader/observability/fhv-alert-policy-v1";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";

export type FhvHostTelemetrySnapshot = FhvOperatorStatusV1["host"] & {
  diskSoftBreached: boolean;
  diskHardBreached: boolean;
};

export function collectFhvHostTelemetry(input?: {
  artifactDirBytes?: number | null;
  postgresConnectivity?: FhvOperatorStatusV1["host"]["postgresConnectivity"];
  datasetReadable?: boolean;
}): FhvHostTelemetrySnapshot {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsedPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : null;
  const load = os.loadavg();
  const diskFreeBytes = freeMem;
  const diskTotalBytes = totalMem;
  const disk = evaluateDiskThresholds({ freeBytes: diskFreeBytes, totalBytes: diskTotalBytes });

  return {
    cpuPct: null,
    loadAvg1: load[0] ?? null,
    loadAvg5: load[1] ?? null,
    loadAvg15: load[2] ?? null,
    ramUsedPct,
    swapUsedPct: null,
    diskFreeBytes,
    diskTotalBytes,
    artifactDirBytes: input?.artifactDirBytes ?? null,
    artifactGrowthBytesPerHour: null,
    inodeUsedPct: null,
    processStatus: "running",
    serviceStatus: "observer_active",
    postgresConnectivity: input?.postgresConnectivity ?? "unknown",
    datasetReadable: input?.datasetReadable ?? false,
    openFiles: null,
    ntpHealthy: null,
    diskSoftBreached: disk.softBreached,
    diskHardBreached: disk.hardBreached,
  };
}
