import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as hostTelemetryModule from "@/lib/trader/observability/fhv-host-telemetry";
import {
  createFhvObserverState,
  runFhvObserverTick,
} from "@/lib/trader/observability/fhv-observer-core";
import { readFhvOperatorStatusTolerant } from "@/lib/trader/observability/fhv-status-writer";

const BASE_TELEMETRY: hostTelemetryModule.FhvHostTelemetrySnapshot = {
  cpuPct: null,
  loadAvg1: 0.1,
  loadAvg5: 0.1,
  loadAvg15: 0.1,
  ramUsedPct: 50,
  swapUsedPct: null,
  diskFreeBytes: 1024,
  diskTotalBytes: 1024 * 1024,
  artifactDirBytes: 512,
  artifactGrowthBytesPerHour: null,
  inodeUsedPct: null,
  processStatus: "running",
  serviceStatus: "observer_active",
  postgresConnectivity: "unknown",
  datasetReadable: false,
  openFiles: null,
  ntpHealthy: null,
  diskSoftBreached: false,
  diskHardBreached: false,
};

describe("DEE-416 FHV observer host safety escalation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets hostSafetyEscalation when disk hard threshold is breached", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-host-safety-"));
    mkdirSync(root, { recursive: true });

    vi.spyOn(hostTelemetryModule, "collectFhvHostTelemetry").mockReturnValue({
      ...BASE_TELEMETRY,
      diskSoftBreached: true,
      diskHardBreached: true,
    });

    const state = createFhvObserverState({
      runRoot: root,
      runId: "host-safety-run",
      organizationId: "00000000-0000-4000-8000-0000000416",
      commandSecret: "fhv-test-command-secret",
    });

    try {
      const result = await runFhvObserverTick(state, {
        nowMs: Date.parse("2026-07-21T06:00:00.000Z"),
        barsProcessed: 10,
        barsTotal: 100,
        phase: "validation",
      });

      expect(result.hostSafetyEscalation).toBe(true);
      expect(result.statusWritten).toBe(true);
      expect(result.alertsFired).toContain("FHV-ALERT-007");

      const status = readFhvOperatorStatusTolerant(root);
      expect(status?.campaign.runId).toBe("host-safety-run");
      expect(status?.recentAlerts.some((alert) => alert.id === "FHV-ALERT-007")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
