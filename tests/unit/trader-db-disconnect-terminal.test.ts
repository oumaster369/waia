import { describe, expect, it, vi } from "vitest";

import { isTransientConnectionError } from "@/db/postgres-client";
import {
  finalizeResearchCampaignOutcomePostgres,
  resolveResearchCampaignCrashFailureCode,
} from "@/lib/trader/research/finalize-research-campaign-outcome";
import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

const ORG_CONTEXT = { organizationId: "00000000-0000-4000-8000-000000000415" } as OrgContext;
const SCOPE = {
  organizationId: ORG_CONTEXT.organizationId,
  strategyId: "mr-zscore",
  strategyVersion: "0.1.0",
};

describe("trader db disconnect terminal (HTR-WP05)", () => {
  it("classifies transient disconnect as CAMPAIGN_INFRA_DISCONNECT", () => {
    const error = new Error("CONNECTION_CLOSED");
    expect(isTransientConnectionError(error)).toBe(true);
    expect(resolveResearchCampaignCrashFailureCode(error)).toBe("CAMPAIGN_INFRA_DISCONNECT");
  });

  it("maps a REPLAY_RUN_INFRA_DISCONNECT crash to CAMPAIGN_INFRA_DISCONNECT (never success)", async () => {
    const ex = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    } as never;
    const outcome = await finalizeResearchCampaignOutcomePostgres(ex, ORG_CONTEXT, {
      kind: "crash",
      scope: SCOPE,
      error: new Error("write CONNECTION_CLOSED pooler:6543"),
      replayTerminalState: "REPLAY_RUN_INFRA_DISCONNECT",
    });
    expect(outcome.kind).toBe("crash");
    expect(outcome.rejectionRecord?.recordBody.failureCode).toBe("CAMPAIGN_INFRA_DISCONNECT");
    expect(outcome.operatorDiagnostics.recordBody.streamingEvidence ?? null).toBeNull();
  });

  it("blocks false success when a replay run did not finish REPLAY_RUN_OK", async () => {
    const ex = { select: vi.fn(), insert: vi.fn(), update: vi.fn() } as never;
    await expect(
      finalizeResearchCampaignOutcomePostgres(ex, ORG_CONTEXT, {
        kind: "success",
        scope: SCOPE,
        replayTerminalState: "REPLAY_RUN_INFRA_DISCONNECT",
      }),
    ).rejects.toThrow(/WP05_FALSE_SUCCESS/);
  });

  it("harness disconnect terminal report passes", async () => {
    const harness = await runCheckpointResumeHarness();
    expect(harness.disconnectTerminal.passed).toBe(true);
  }, 240_000);
});
