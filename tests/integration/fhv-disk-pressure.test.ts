import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFhvAlertLedger } from "@/lib/trader/observability/fhv-alert-ledger";
import { evaluateDiskThresholds } from "@/lib/trader/observability/fhv-alert-policy-v1";
import * as hostTelemetryModule from "@/lib/trader/observability/fhv-host-telemetry";
import {
  createFhvObserverState,
  runFhvObserverTick,
} from "@/lib/trader/observability/fhv-observer-core";
import { GIB } from "@/lib/trader/observability/fhv-observability.constants";
import { readFhvOperatorStatusTolerant } from "@/lib/trader/observability/fhv-status-writer";

const BASE_TELEMETRY: hostTelemetryModule.FhvHostTelemetrySnapshot = {
  cpuPct: null,
  loadAvg1: 0.1,
  loadAvg5: 0.1,
  loadAvg15: 0.1,
  ramUsedPct: 50,
  swapUsedPct: null,
  diskFreeBytes: 15 * GIB,
  diskTotalBytes: 100 * GIB,
  artifactDirBytes: 512,
  artifactGrowthBytesPerHour: null,
  inodeUsedPct: null,
  processStatus: "running",
  serviceStatus: "observer_active",
  postgresConnectivity: "ok",
  datasetReadable: true,
  openFiles: null,
  ntpHealthy: null,
  diskSoftBreached: false,
  diskHardBreached: false,
};

describe("DEE-416 FHV disk pressure alerts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("evaluates pinned soft and hard disk threshold rules", () => {
    const softOnly = evaluateDiskThresholds({ freeBytes: 15 * GIB, totalBytes: 100 * GIB });
    expect(softOnly.softBreached).toBe(true);
    expect(softOnly.hardBreached).toBe(false);

    const hard = evaluateDiskThresholds({ freeBytes: 4 * GIB, totalBytes: 100 * GIB });
    expect(hard.softBreached).toBe(true);
    expect(hard.hardBreached).toBe(true);
  });

  it("fires soft disk alert through observer tick without hard escalation", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-disk-soft-"));
    mkdirSync(root, { recursive: true });

    vi.spyOn(hostTelemetryModule, "collectFhvHostTelemetry").mockReturnValue({
      ...BASE_TELEMETRY,
      diskSoftBreached: true,
      diskHardBreached: false,
    });

    const state = createFhvObserverState({
      runRoot: root,
      runId: "disk-soft-run",
      organizationId: "00000000-0000-4000-8000-0000000416",
      commandSecret: "fhv-test-command-secret",
    });

    try {
      const result = await runFhvObserverTick(state, {
        nowMs: Date.parse("2026-07-21T06:00:00.000Z"),
      });

      expect(result.hostSafetyEscalation).toBe(false);
      expect(result.alertsFired).toContain("FHV-ALERT-006");
      expect(result.alertsFired).not.toContain("FHV-ALERT-007");

      const status = readFhvOperatorStatusTolerant(root);
      expect(status?.recentAlerts.some((alert) => alert.id === "FHV-ALERT-006")).toBe(true);
      expect(readFhvAlertLedger(root).some((entry) => entry.alertId === "FHV-ALERT-006")).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fires hard disk alert and host safety escalation through observer tick", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-disk-hard-"));
    mkdirSync(root, { recursive: true });

    vi.spyOn(hostTelemetryModule, "collectFhvHostTelemetry").mockReturnValue({
      ...BASE_TELEMETRY,
      diskSoftBreached: true,
      diskHardBreached: true,
    });

    const state = createFhvObserverState({
      runRoot: root,
      runId: "disk-hard-run",
      organizationId: "00000000-0000-4000-8000-0000000416",
      commandSecret: "fhv-test-command-secret",
    });

    try {
      const result = await runFhvObserverTick(state, {
        nowMs: Date.parse("2026-07-21T06:10:00.000Z"),
      });

      expect(result.hostSafetyEscalation).toBe(true);
      expect(result.alertsFired).toContain("FHV-ALERT-007");
      expect(readFhvAlertLedger(root).some((entry) => entry.alertId === "FHV-ALERT-007")).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
