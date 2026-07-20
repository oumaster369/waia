import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCampaignOperatorDiagnostics } from "@/lib/trader/research/build-campaign-operator-diagnostics";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import { createPlaceholderResearchValidationMetricsV2 } from "@/lib/trader/research/placeholder-research-validation-metrics";
import { sealResearchCampaignOutcomeArtifacts } from "@/lib/trader/research/finalize-research-campaign-outcome";
import { buildEvolutionCycleMvp } from "@/lib/trader/research/build-evolution-cycle-mvp";

describe("unified campaign outcome failure sealing (PR2)", () => {
  it("seals success path with operator diagnostics only", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "waia-outcome-success-"));
    try {
      const operatorDiagnostics = buildCampaignOperatorDiagnostics({
        organizationId: "org-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.7",
        outcomeKind: "success",
        inventory: { openQtyBySymbol: new Map([["BTC/USDT", "0"]]) },
        parityStatus: "ok",
      });

      const paths = sealResearchCampaignOutcomeArtifacts({
        vaultDir: tmpDir,
        naming: "flat",
        diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
        outcome: { kind: "success", operatorDiagnostics },
        manifest: { schemaVersion: "m9_v2_research_campaign_v1", ok: true },
      });

      const diagnostics = JSON.parse(readFileSync(paths.operatorDiagnosticsPath, "utf8")) as {
        recordBody: { outcomeKind: string; parityStatus: string; errorName: null };
      };
      expect(paths.rejectionRecordPath).toBeNull();
      expect(diagnostics.recordBody.outcomeKind).toBe("success");
      expect(diagnostics.recordBody.parityStatus).toBe("ok");
      expect(diagnostics.recordBody.errorName).toBeNull();
      expect(paths.manifestPath).toBeTruthy();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("seals governed reject path with rejection, evolution, and diagnostics", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "waia-outcome-reject-"));
    try {
      const placeholder = createPlaceholderResearchValidationMetricsV2();
      const rejectionRecord = buildResearchRejectionRecord({
        organizationId: "org-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.7",
        candidateId: "candidate-1",
        datasetId: "dataset-1",
        backtestRunId: "bt-1",
        blindValidationResultId: "blind-1",
        failureCode: "MULTI_REGIME_COVERAGE_INSUFFICIENT",
        failureMessage: "regime coverage insufficient",
        blindConsumed: true,
        walkForwardWindowCount: 3,
        validationMetrics: placeholder,
        walkForwardMetrics: [],
        blindMetrics: placeholder,
      });
      const operatorDiagnostics = buildCampaignOperatorDiagnostics({
        organizationId: "org-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.7",
        outcomeKind: "governed_reject",
        error: new Error("regime coverage insufficient"),
        parityStatus: "not_checked",
      });
      const evolutionCycle = buildEvolutionCycleMvp({ rejectionRecord });

      const paths = sealResearchCampaignOutcomeArtifacts({
        vaultDir: tmpDir,
        naming: "flat",
        rejectionBasename: "m9-research-rejection-record.json",
        evolutionBasename: "m9-evolution-cycle-mvp.json",
        diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
        outcome: {
          kind: "governed_reject",
          rejectionRecord,
          operatorDiagnostics,
          evolutionCycle,
        },
      });

      const diagnostics = JSON.parse(readFileSync(paths.operatorDiagnosticsPath, "utf8")) as {
        recordBody: { outcomeKind: string };
      };
      expect(paths.rejectionRecordPath).toBeTruthy();
      expect(paths.evolutionCyclePath).toBeTruthy();
      expect(diagnostics.recordBody.outcomeKind).toBe("governed_reject");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("seals crash path with rejection, evolution, and diagnostics", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "waia-outcome-crash-"));
    try {
      const placeholder = createPlaceholderResearchValidationMetricsV2();
      const rejectionRecord = buildResearchRejectionRecord({
        organizationId: "org-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.7",
        candidateId: "candidate-1",
        datasetId: "dataset-1",
        backtestRunId: "bt-1",
        blindValidationResultId: "blind-1",
        failureCode: "INVENTORY_RECONCILIATION",
        failureMessage: "sell quantity exceeds open quantity",
        blindConsumed: false,
        walkForwardWindowCount: 0,
        validationMetrics: placeholder,
        walkForwardMetrics: [],
        blindMetrics: placeholder,
      });
      const operatorDiagnostics = buildCampaignOperatorDiagnostics({
        organizationId: "org-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.7",
        outcomeKind: "crash",
        error: new Error("sell quantity exceeds open quantity"),
        inventory: { openQtyBySymbol: new Map([["BTC/USDT", "0.00731991"]]) },
        parityStatus: "not_checked",
      });
      const evolutionCycle = buildEvolutionCycleMvp({ rejectionRecord });

      const paths = sealResearchCampaignOutcomeArtifacts({
        vaultDir: tmpDir,
        naming: "flat",
        rejectionBasename: "m9-research-rejection-record.json",
        evolutionBasename: "m9-evolution-cycle-mvp.json",
        diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
        outcome: {
          kind: "crash",
          rejectionRecord,
          operatorDiagnostics,
          evolutionCycle,
        },
      });

      const diagnostics = JSON.parse(readFileSync(paths.operatorDiagnosticsPath, "utf8")) as {
        recordBody: {
          outcomeKind: string;
          inventorySnapshot: { openQtyBySymbol: Record<string, string> } | null;
        };
      };
      expect(paths.rejectionRecordPath).toBeTruthy();
      expect(diagnostics.recordBody.outcomeKind).toBe("crash");
      expect(diagnostics.recordBody.inventorySnapshot?.openQtyBySymbol["BTC/USDT"]).toBe(
        "0.00731991",
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
