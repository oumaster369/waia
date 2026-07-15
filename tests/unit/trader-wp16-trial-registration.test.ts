import { describe, expect, it } from "vitest";

import { createStrategyTrialService } from "@/lib/trader/intelligence/strategies/strategy-trial-service";
import type { StrategyTrialRepository } from "@/lib/trader/intelligence/strategies/strategy-trial-repository-postgres";
import type { StrategyTrialEvent } from "@/lib/trader/intelligence/strategies/strategy-trial.types";

function memoryTrialRepo(): StrategyTrialRepository {
  const store: StrategyTrialEvent[] = [];
  return {
    async findByBusinessKey(_context, key) {
      return (
        store.find(
          (row) =>
            row.strategyId === key.strategyId &&
            row.strategyVersion === key.strategyVersion &&
            row.runId === key.runId &&
            row.cycleId === key.cycleId &&
            row.symbol === key.symbol,
        ) ?? null
      );
    },
    async countByRun(_context, strategyId, strategyVersion, runId) {
      return store.filter(
        (row) =>
          row.strategyId === strategyId &&
          row.strategyVersion === strategyVersion &&
          row.runId === runId,
      ).length;
    },
    async getMaxSeq(_context, strategyId, strategyVersion, runId) {
      const rows = store.filter(
        (row) =>
          row.strategyId === strategyId &&
          row.strategyVersion === strategyVersion &&
          row.runId === runId,
      );
      return rows.at(-1)?.seq ?? null;
    },
    async insert(_context, row) {
      const event = { ...row, createdAt: new Date().toISOString() };
      store.push(event);
      return event;
    },
  };
}

describe("HTR-WP16 trial registration", () => {
  it("appends trials and derives counts at read time", async () => {
    const service = createStrategyTrialService(memoryTrialRepo());
    const context = { organizationId: "org" };
    const base = {
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      runId: "run-1",
      cycleId: "0",
      symbol: "BTC/USDT",
      accountKey: "acct",
      portfolioId: "portfolio",
      eventTime: "2026-01-01T00:00:00.000Z",
      ingestTime: "2026-01-01T00:00:00.000Z",
      registeredBy: "test",
    };
    await service.registerStrategyTrial(context, {
      ...base,
      deterministicId: "00000000-0000-4000-8000-000000000001",
    });
    await service.registerStrategyTrial(context, {
      ...base,
      cycleId: "1",
      deterministicId: "00000000-0000-4000-8000-000000000002",
    });
    const counts = await service.getStrategyTrialCounts(
      context,
      "mean_reversion_v0",
      "0.1.0",
      "run-1",
    );
    expect(counts.total).toBe(2);
  });

  it("is idempotent for the same deterministic id", async () => {
    const service = createStrategyTrialService(memoryTrialRepo());
    const context = { organizationId: "org" };
    const input = {
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      runId: "run-1",
      cycleId: "0",
      symbol: "BTC/USDT",
      accountKey: "acct",
      portfolioId: "portfolio",
      eventTime: "2026-01-01T00:00:00.000Z",
      ingestTime: "2026-01-01T00:00:00.000Z",
      registeredBy: "test",
      deterministicId: "00000000-0000-4000-8000-000000000099",
    };
    const first = await service.registerStrategyTrial(context, input);
    const second = await service.registerStrategyTrial(context, input);
    expect(second.id).toBe(first.id);
  });
});
