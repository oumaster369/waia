import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  createFhvObserverState,
  runFhvObserverTick,
} from "@/lib/trader/observability/fhv-observer-core";
import { readFhvAlertLedger } from "@/lib/trader/observability/fhv-alert-ledger";
import { readFhvOperatorStatusTolerant } from "@/lib/trader/observability/fhv-status-writer";

describe("DEE-416 FHV observer restart visibility", () => {
  it("surfaces processRestartCount in status and emits restart alert", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-restart-"));
    mkdirSync(root, { recursive: true });

    const state = createFhvObserverState({
      runRoot: root,
      runId: "restart-visibility-run",
      organizationId: "00000000-0000-4000-8000-0000000416",
      commandSecret: "fhv-test-command-secret",
      observerTunnelSecret: "fhv-test-tunnel-secret",
    });

    try {
      const tickOne = await runFhvObserverTick(state, {
        nowMs: Date.parse("2026-07-21T06:00:00.000Z"),
        processRestartCount: 1,
        barsProcessed: 5,
        barsTotal: 50,
      });
      expect(tickOne.alertsFired).toContain("FHV-ALERT-004");

      const tickTwo = await runFhvObserverTick(state, {
        nowMs: Date.parse("2026-07-21T06:05:00.000Z"),
        processRestartCount: 2,
        barsProcessed: 12,
        barsTotal: 50,
      });
      expect(tickTwo.alertsFired).toContain("FHV-ALERT-004");

      const status = readFhvOperatorStatusTolerant(root);
      expect(status?.campaign.processRestartCount).toBe(2);

      const ledger = readFhvAlertLedger(root);
      expect(ledger.some((entry) => entry.alertId === "FHV-ALERT-004")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
