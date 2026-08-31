import { describe, expect, it, vi } from "vitest";

import { createHistoricalModeledCapitalBindingV2, createHistoricalModeledExecutionRegistryV2 } from "@/lib/trader/historical-simulation-v2/modeled-capital-binding-v2";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";

const digest = (value: string) => value.repeat(64);
const cycle = Object.freeze({
  cycleId: "cycle-1",
  observedAt: "2026-08-30T10:00:00.000Z",
  symbol: "BTCUSDT",
  referencePrice: "100",
});

describe("historical modeled capital binding v2", () => {
  it("creates deterministic non-capital exit evidence and never calls canonical Reality/Risk/Guardian", async () => {
    const registered: unknown[] = [];
    const evidence: Array<Record<string, unknown>> = [];
    const advance = vi.fn(async () => undefined);
    const canonicalReality = vi.fn(() => { throw new Error("must not be called"); });
    const canonicalRisk = vi.fn(() => { throw new Error("must not be called"); });
    const canonicalGuardian = vi.fn(() => { throw new Error("must not be called"); });
    void [canonicalReality, canonicalRisk, canonicalGuardian];
    const binding = createHistoricalModeledCapitalBindingV2({
      organizationId: "org-1",
      accountId: "account-1",
      runId: "run-1",
      resolveCycle: () => cycle,
      decide: async () => { throw new Error("entry not exercised"); },
      loadAccounting: async () => ({
        frontierContentDigestHex: digest("a"),
        posture: "NORMAL",
        accounting: {
          reconciledExposureNotional: "100",
          worstCasePendingExposureNotional: "0",
          outstandingReservationNotional: "0",
          exposureLimitNotional: "1000",
        },
      }),
      exchange: { registerOrder: (order: OrderRow) => { registered.push(order); } } as never,
      executionRegistry: createHistoricalModeledExecutionRegistryV2(),
      decisionBarIndex: () => 7,
      evaluateGuardian: async () => ({ status: "NONE", reasonCodes: [] }),
      persistEvidence: async (value) => { evidence.push(value as unknown as Record<string, unknown>); },
      advanceModeledExecution: async (value) => { await advance(value); return { observedExecutionEffects: [] }; },
      learningProjection: async () => ({
        status: "NO_UPDATE",
        reasonCodes: ["NO_MATURED_OUTCOME"],
        calibrationObservationContentDigestHex: null,
        knowledgeUpdateContentDigestHex: null,
        eligibleResolutionAtUtc: null,
        visibleFromPitAnchorUtc: null,
      }),
    });
    const proposal = {
      decisionSemanticMode: "HISTORICAL" as const,
      action: "CLOSE" as const,
      quantity: "0.5",
      proposalContentDigestHex: digest("b"),
      reasonCodes: [],
      decisionContentDigestHex: digest("c"),
      whyNotCashReceiptDigestHex: digest("d"),
      evLower: "1",
      evBase: "2",
      evUpper: "3",
    };
    const first = await binding.modeledExit.execute({ cycle, proposal });
    const second = await binding.modeledExit.execute({ cycle, proposal });

    expect(first).toEqual(second);
    expect(registered).toHaveLength(2);
    expect(evidence.every((row) => row.source === "MODELED_HISTORICAL" && row.capitalEligible === false)).toBe(true);
    expect(new Set(evidence.map((row) => row.schemaVersion))).not.toContain("reality-projection/v2");
    expect(canonicalReality).not.toHaveBeenCalled();
    expect(canonicalRisk).not.toHaveBeenCalled();
    expect(canonicalGuardian).not.toHaveBeenCalled();

    const projection = await binding.resolveLedgerProjection({
      cycle,
      proposal,
      knowledgeBefore: { asOf: cycle.observedAt, contentDigestHex: digest("e") },
      knowledgeAfterClosure: { asOf: cycle.observedAt, contentDigestHex: digest("f") },
      closures: [],
    });
    expect(advance).toHaveBeenCalledOnce();
    expect(projection.accounting.frontierContentDigestHex).toBe(digest("a"));
    expect(projection.guardian.status).toBe("NONE");
  });
});
