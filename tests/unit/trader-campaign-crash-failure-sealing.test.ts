import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCampaignOperatorDiagnostics } from "@/lib/trader/research/build-campaign-operator-diagnostics";
import { buildResearchRejectionRecord } from "@/lib/trader/research/build-research-rejection-record";
import { createPlaceholderResearchValidationMetricsV2 } from "@/lib/trader/research/placeholder-research-validation-metrics";
import {
  resolveResearchCampaignCrashFailureCode,
  sealResearchCampaignCrashArtifacts,
} from "@/lib/trader/research/finalize-research-campaign-crash";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";

describe("research campaign crash failure sealing (PR1)", () => {
  it("maps PaperPnLReconciliationError to INVENTORY_RECONCILIATION", () => {
    const error = new PaperPnLReconciliationError("sell quantity 1 exceeds open quantity 0");
    expect(resolveResearchCampaignCrashFailureCode(error)).toBe("INVENTORY_RECONCILIATION");
    expect(resolveResearchCampaignCrashFailureCode(new Error("boom"))).toBe("CAMPAIGN_CRASH");
  });

  it("writes rejection, evolution, and operator diagnostics artifacts", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "waia-crash-seal-"));
    try {
      const placeholder = createPlaceholderResearchValidationMetricsV2();
      const rejectionRecord = buildResearchRejectionRecord({
        organizationId: "org-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.6",
        candidateId: "candidate-1",
        datasetId: "dataset-1",
        backtestRunId: "bt-1",
        blindValidationResultId: "blind-1",
        failureCode: "INVENTORY_RECONCILIATION",
        failureMessage: "sell quantity 0.00866055 exceeds open quantity 0.00731991",
        blindConsumed: false,
        walkForwardWindowCount: 0,
        validationMetrics: placeholder,
        walkForwardMetrics: [],
        blindMetrics: placeholder,
      });
      const operatorDiagnostics = buildCampaignOperatorDiagnostics({
        organizationId: "org-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.6",
        error: new PaperPnLReconciliationError(
          "sell quantity 0.00866055 exceeds open quantity 0.00731991",
        ),
        inventory: {
          openQtyBySymbol: new Map([["BTC/USDT", "0.00731991"]]),
        },
      });

      const paths = sealResearchCampaignCrashArtifacts({
        vaultDir: tmpDir,
        naming: "flat",
        rejectionBasename: "m9-research-rejection-record.json",
        evolutionBasename: "m9-evolution-cycle-mvp.json",
        diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
        rejectionRecord,
        operatorDiagnostics,
      });

      expect(paths.operatorDiagnosticsPath).toBeTruthy();
      const rejection = JSON.parse(readFileSync(paths.rejectionRecordPath, "utf8")) as {
        recordBody: { failureCode: string };
      };
      const diagnostics = JSON.parse(readFileSync(paths.operatorDiagnosticsPath!, "utf8")) as {
        recordBody: {
          errorName: string;
          inventorySnapshot: { openQtyBySymbol: Record<string, string> } | null;
        };
      };

      expect(rejection.recordBody.failureCode).toBe("INVENTORY_RECONCILIATION");
      expect(diagnostics.recordBody.errorName).toBe("PaperPnLReconciliationError");
      expect(diagnostics.recordBody.inventorySnapshot?.openQtyBySymbol["BTC/USDT"]).toBe(
        "0.00731991",
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
