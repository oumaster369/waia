import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  appendFhvAlertLedger,
  readFhvAlertLedger,
} from "@/lib/trader/observability/fhv-alert-ledger";
import { evaluateFhvObserverAlerts } from "@/lib/trader/observability/fhv-alert-catalogue.v1";
import { FHV_ALERT_POLICY_BASELINE_FHV_V1 } from "@/lib/trader/observability/fhv-alert-policy-v1";
import {
  buildAndWriteFhvOperatorStatus,
  readFhvOperatorStatusTolerant,
} from "@/lib/trader/observability/fhv-status-writer";

describe("DEE-416 FHV postgres disconnect alert", () => {
  it("fires FHV-ALERT-009 when postgres is down beyond grace period", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-postgres-"));
    mkdirSync(root, { recursive: true });

    const policy = FHV_ALERT_POLICY_BASELINE_FHV_V1;
    const postgresDownSec = policy.postgresFailureGraceSec + 5;

    try {
      const alerts = evaluateFhvObserverAlerts({
        policy,
        heartbeatAgeSec: 0,
        stallSec: 0,
        checkpointAgeSec: null,
        diskSoftBreached: false,
        diskHardBreached: false,
        postgresDownSec,
        processRestartCount: 0,
      });
      expect(alerts).toContain("FHV-ALERT-009");

      const observedAt = "2026-07-21T06:00:00.000Z";
      for (const alertId of alerts) {
        appendFhvAlertLedger(root, {
          alertId,
          severity: "CRITICAL",
          firedAtUtc: observedAt,
          message: "postgres unavailable",
          detector: "Observer",
          dedupeKey: `${alertId}:postgres-down`,
        });
      }

      buildAndWriteFhvOperatorStatus(root, {
        runId: "postgres-down-run",
        phase: "validation",
        codeSha: "sha416",
        artifactDigest: "artifact-digest",
        datasetSeal: "dataset-seal",
        datasetDigest: "dataset-digest",
        configurationDigest: "config-digest",
        observedAt,
        hostTelemetry: {
          postgresConnectivity: "unavailable",
        },
        recentAlerts: alerts.map((alertId) => ({
          id: alertId,
          label: alertId,
          atUtc: observedAt,
          artifactRef: `fhv-artifact/v1/alert/postgres-down-run/${alertId}#0`,
        })),
      });

      const ledger = readFhvAlertLedger(root);
      expect(ledger.some((entry) => entry.alertId === "FHV-ALERT-009")).toBe(true);

      const status = readFhvOperatorStatusTolerant(root);
      expect(status?.host.postgresConnectivity).toBe("unavailable");
      expect(status?.recentAlerts.some((alert) => alert.id === "FHV-ALERT-009")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not fire FHV-ALERT-009 within postgres failure grace window", () => {
    const policy = FHV_ALERT_POLICY_BASELINE_FHV_V1;
    const alerts = evaluateFhvObserverAlerts({
      policy,
      heartbeatAgeSec: 0,
      stallSec: 0,
      checkpointAgeSec: null,
      diskSoftBreached: false,
      diskHardBreached: false,
      postgresDownSec: policy.postgresFailureGraceSec,
      processRestartCount: 0,
    });
    expect(alerts).not.toContain("FHV-ALERT-009");
  });
});
