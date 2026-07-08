import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const candidateMocks = vi.hoisted(() => ({
  getLatest: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock("@/lib/trader/research/strategy-candidate-repository-postgres", () => ({
  getLatestCandidateForStrategyPostgres: candidateMocks.getLatest,
  updateStrategyCandidateStatusPostgres: candidateMocks.updateStatus,
}));

import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";
import {
  finalizeResearchCampaignOutcomePostgres,
  resolveResearchCampaignCrashFailureCode,
  sealResearchCampaignOutcomeArtifacts,
} from "@/lib/trader/research/finalize-research-campaign-outcome";

function transientError(message = "write CONNECTION_CLOSED"): Error {
  return Object.assign(new Error(message), { code: "CONNECTION_CLOSED" });
}

const fakeEx = {} as never;
const context = requireOrgContext("org-1");

describe("resolveResearchCampaignCrashFailureCode (DEE-399)", () => {
  it("classifies PaperPnLReconciliationError as INVENTORY_RECONCILIATION", () => {
    expect(
      resolveResearchCampaignCrashFailureCode(
        new PaperPnLReconciliationError("sell quantity 1 exceeds open quantity 0"),
      ),
    ).toBe("INVENTORY_RECONCILIATION");
  });

  it("classifies a transient connection error as CAMPAIGN_INFRA_DISCONNECT", () => {
    expect(resolveResearchCampaignCrashFailureCode(transientError())).toBe(
      "CAMPAIGN_INFRA_DISCONNECT",
    );
  });

  it("classifies an unrelated error as CAMPAIGN_CRASH (unchanged regression)", () => {
    expect(resolveResearchCampaignCrashFailureCode(new Error("boom"))).toBe("CAMPAIGN_CRASH");
  });
});

describe("finalizeResearchCampaignOutcomePostgres crash-path DB resilience (DEE-399)", () => {
  beforeEach(() => {
    candidateMocks.getLatest.mockReset();
    candidateMocks.updateStatus.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seals CAMPAIGN_INFRA_DISCONNECT when the original failure was an unrecovered transient disconnect", async () => {
    candidateMocks.getLatest.mockResolvedValue(null);

    const outcome = await finalizeResearchCampaignOutcomePostgres(fakeEx, context, {
      kind: "crash",
      scope: { organizationId: "org-1", strategyId: "mean_reversion_v0", strategyVersion: "0.1.7" },
      error: transientError(),
    });

    expect(outcome.rejectionRecord?.recordBody.failureCode).toBe("CAMPAIGN_INFRA_DISCONNECT");
    // Never fabricate success: crash outcome always seals a rejection record.
    expect(outcome.kind).toBe("crash");
    expect(outcome.operatorDiagnostics.recordBody.outcomeKind).toBe("crash");
  });

  it("still seals CAMPAIGN_CRASH for a generic error (unchanged regression)", async () => {
    candidateMocks.getLatest.mockResolvedValue(null);

    const outcome = await finalizeResearchCampaignOutcomePostgres(fakeEx, context, {
      kind: "crash",
      scope: { organizationId: "org-1", strategyId: "mean_reversion_v0", strategyVersion: "0.1.7" },
      error: new Error("boom"),
    });

    expect(outcome.rejectionRecord?.recordBody.failureCode).toBe("CAMPAIGN_CRASH");
  });

  it("still seals INVENTORY_RECONCILIATION for a paper P&L error (unchanged regression)", async () => {
    candidateMocks.getLatest.mockResolvedValue(null);

    const outcome = await finalizeResearchCampaignOutcomePostgres(fakeEx, context, {
      kind: "crash",
      scope: { organizationId: "org-1", strategyId: "mean_reversion_v0", strategyVersion: "0.1.7" },
      error: new PaperPnLReconciliationError("sell quantity 1 exceeds open quantity 0"),
    });

    expect(outcome.rejectionRecord?.recordBody.failureCode).toBe("INVENTORY_RECONCILIATION");
  });

  it("transient-recovers-and-continues: candidate status write recovers and the artifact reflects the real candidate", async () => {
    vi.useFakeTimers();
    candidateMocks.getLatest.mockResolvedValue({
      id: "candidate-1",
      blindUsed: true,
    });
    candidateMocks.updateStatus
      .mockRejectedValueOnce(transientError())
      .mockRejectedValueOnce(transientError())
      .mockResolvedValueOnce({ id: "candidate-1" });

    const outcomePromise = finalizeResearchCampaignOutcomePostgres(fakeEx, context, {
      kind: "crash",
      scope: { organizationId: "org-1", strategyId: "mean_reversion_v0", strategyVersion: "0.1.7" },
      error: transientError(),
    });
    await vi.runAllTimersAsync();
    const outcome = await outcomePromise;

    expect(candidateMocks.updateStatus).toHaveBeenCalledTimes(3); // bounded: 2 failed + 1 recovered, no duplicates beyond that
    expect(outcome.rejectionRecord?.recordBody.candidateId).toBe("candidate-1");
    expect(outcome.rejectionRecord?.recordBody.blindConsumed).toBe(true);
  });

  it("transient-exhausted: candidate status write never recovers but the honest artifact is still sealed (never blocked, never fabricated)", async () => {
    vi.useFakeTimers();
    candidateMocks.getLatest.mockResolvedValue({ id: "candidate-2", blindUsed: false });
    candidateMocks.updateStatus.mockRejectedValue(transientError());

    const outcomePromise = finalizeResearchCampaignOutcomePostgres(fakeEx, context, {
      kind: "crash",
      scope: { organizationId: "org-1", strategyId: "mean_reversion_v0", strategyVersion: "0.1.7" },
      error: transientError(),
    });
    await vi.runAllTimersAsync();
    const outcome = await outcomePromise;

    // Bounded retries only (DEFAULT_CAMPAIGN_DB_RETRY_POLICY.maxAttempts=5) — never unbounded/duplicated.
    expect(candidateMocks.updateStatus).toHaveBeenCalledTimes(5);
    // The write failure must not throw or block sealing the honest rejection artifact.
    expect(outcome.kind).toBe("crash");
    expect(outcome.rejectionRecord?.recordBody.failureCode).toBe("CAMPAIGN_INFRA_DISCONNECT");
    expect(outcome.rejectionRecord?.recordBody.candidateId).toBe("candidate-2");
  });

  it("resilient finalization writes an artifact to disk after a simulated connection drop", async () => {
    vi.useFakeTimers();
    candidateMocks.getLatest.mockResolvedValue({ id: "candidate-3", blindUsed: false });
    candidateMocks.updateStatus.mockRejectedValueOnce(transientError()).mockResolvedValueOnce({
      id: "candidate-3",
    });

    const outcomePromise = finalizeResearchCampaignOutcomePostgres(fakeEx, context, {
      kind: "crash",
      scope: { organizationId: "org-1", strategyId: "mean_reversion_v0", strategyVersion: "0.1.7" },
      error: transientError(),
    });
    await vi.runAllTimersAsync();
    const outcome = await outcomePromise;

    const tmpDir = mkdtempSync(join(tmpdir(), "waia-outcome-resilience-"));
    try {
      const paths = sealResearchCampaignOutcomeArtifacts({
        vaultDir: tmpDir,
        naming: "flat",
        rejectionBasename: "m9-research-rejection-record.json",
        evolutionBasename: "m9-evolution-cycle-mvp.json",
        diagnosticsBasename: "m9-campaign-operator-diagnostics.json",
        outcome,
      });

      expect(paths.rejectionRecordPath).toBeTruthy();
      const rejection = JSON.parse(readFileSync(paths.rejectionRecordPath!, "utf8")) as {
        recordBody: { candidateId: string; failureCode: string };
      };
      expect(rejection.recordBody.candidateId).toBe("candidate-3");
      expect(rejection.recordBody.failureCode).toBe("CAMPAIGN_INFRA_DISCONNECT");
      expect(candidateMocks.updateStatus).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
