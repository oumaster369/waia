import os from "node:os";
import { statfsSync } from "node:fs";

import { evaluateDiskThresholds } from "@/lib/trader/observability/fhv-alert-policy-v1";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";
import { measureBoundedDirectoryBytes } from "@/lib/trader/observability/fhv-telemetry-probes";

export type FhvHostTelemetrySnapshot = FhvOperatorStatusV1["host"] & {
  diskSoftBreached: boolean;
  diskHardBreached: boolean;
};

export function collectFhvHostTelemetry(input?: {
  runRoot?: string;
  artifactDirBytes?: number | null;
  postgresConnectivity?: FhvOperatorStatusV1["host"]["postgresConnectivity"];
  datasetReadable?: boolean | null;
  filesystemPath?: string;
}): FhvHostTelemetrySnapshot {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramUsedPct = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : null;
  const load = os.loadavg();

  let diskFreeBytes: number | null = null;
  let diskTotalBytes: number | null = null;
  try {
    const fsPath = input?.filesystemPath ?? input?.runRoot ?? process.cwd();
    const stats = statfsSync(fsPath);
    const blockSize = stats.bsize;
    diskTotalBytes = stats.blocks * blockSize;
    diskFreeBytes = stats.bfree * blockSize;
  } catch {
    diskFreeBytes = null;
    diskTotalBytes = null;
  }

  const disk =
    diskFreeBytes !== null && diskTotalBytes !== null
      ? evaluateDiskThresholds({ freeBytes: diskFreeBytes, totalBytes: diskTotalBytes })
      : { softBreached: false, hardBreached: false };

  const artifactDirBytes =
    input?.artifactDirBytes ??
    (input?.runRoot ? measureBoundedDirectoryBytes(input.runRoot) : null);

  return {
    cpuPct: null,
    loadAvg1: load[0] ?? null,
    loadAvg5: load[1] ?? null,
    loadAvg15: load[2] ?? null,
    ramUsedPct,
    swapUsedPct: null,
    diskFreeBytes,
    diskTotalBytes,
    artifactDirBytes,
    artifactGrowthBytesPerHour: null,
    inodeUsedPct: null,
    processStatus: "running",
    serviceStatus: "observer_active",
    postgresConnectivity: input?.postgresConnectivity ?? "unknown",
    datasetReadable: input?.datasetReadable ?? null,
    openFiles: null,
    ntpHealthy: null,
    diskSoftBreached: disk.softBreached,
    diskHardBreached: disk.hardBreached,
  };
}
