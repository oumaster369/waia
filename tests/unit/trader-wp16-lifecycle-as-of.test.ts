import { describe, expect, it } from "vitest";

import { createStrategyLifecycleService } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-service";
import type { StrategyLifecycleRepository } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-repository-postgres";
import type { StrategyLifecycleEvent } from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";

function memoryRepo(events: StrategyLifecycleEvent[] = []): StrategyLifecycleRepository {
  const store = [...events];
  return {
    async listEvents(_context, strategyId, strategyVersion) {
      return store
        .filter((e) => e.strategyId === strategyId && e.strategyVersion === strategyVersion)
        .sort((a, b) => a.seq - b.seq);
    },
    async findBySeq() {
      return null;
    },
    async getMaxSeq(_context, strategyId, strategyVersion) {
      const filtered = store.filter(
        (e) => e.strategyId === strategyId && e.strategyVersion === strategyVersion,
      );
      return filtered.at(-1)?.seq ?? null;
    },
    async insert(_context, row) {
      const event = { ...row, createdAt: new Date().toISOString() };
      store.push(event);
      return event;
    },
  };
}

describe("HTR-WP16 lifecycle as-of", () => {
  it("returns state at deterministic as-of without lookahead", async () => {
    const repo = memoryRepo([
      {
        id: "1",
        organizationId: "org",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        fromState: null,
        toState: "PAPER",
        actor: "HUMAN",
        approvalRef: "svg",
        reasonCode: null,
        seq: 1,
        effectiveAt: "2026-01-01T00:00:00.000Z",
        runId: null,
        contentDigest: "a".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        organizationId: "org",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        fromState: "PAPER",
        toState: "RETIRED",
        actor: "HUMAN",
        approvalRef: "svg-2",
        reasonCode: null,
        seq: 2,
        effectiveAt: "2026-02-01T00:00:00.000Z",
        runId: null,
        contentDigest: "b".repeat(64),
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    const service = createStrategyLifecycleService(repo);
    const context = { organizationId: "org" };
    expect(
      await service.getLifecycleStateAsOf(
        context,
        "mean_reversion_v0",
        "0.1.0",
        "2026-01-15T00:00:00.000Z",
      ),
    ).toBe("PAPER");
    expect(
      await service.getLifecycleStateAsOf(
        context,
        "mean_reversion_v0",
        "0.1.0",
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe("PAPER");
    expect(
      await service.getLifecycleStateAsOf(
        context,
        "mean_reversion_v0",
        "0.1.0",
        "2025-12-01T00:00:00.000Z",
      ),
    ).toBeNull();
  });
});
