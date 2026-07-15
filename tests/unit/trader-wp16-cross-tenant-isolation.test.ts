import { describe, expect, it } from "vitest";

import { createStrategyLifecycleService } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-service";
import type { StrategyLifecycleRepository } from "@/lib/trader/intelligence/strategies/strategy-lifecycle-repository-postgres";
import type { StrategyLifecycleEvent } from "@/lib/trader/intelligence/strategies/strategy-lifecycle.types";

function isolatedRepo(store: StrategyLifecycleEvent[]): StrategyLifecycleRepository {
  return {
    async listEvents(context, strategyId, strategyVersion) {
      return store
        .filter(
          (e) =>
            e.organizationId === context.organizationId &&
            e.strategyId === strategyId &&
            e.strategyVersion === strategyVersion,
        )
        .sort((a, b) => a.seq - b.seq);
    },
    async findBySeq() {
      return null;
    },
    async getMaxSeq(context, strategyId, strategyVersion) {
      const filtered = store.filter(
        (e) =>
          e.organizationId === context.organizationId &&
          e.strategyId === strategyId &&
          e.strategyVersion === strategyVersion,
      );
      return filtered.at(-1)?.seq ?? null;
    },
    async insert(context, row) {
      const event = {
        ...row,
        organizationId: context.organizationId,
        createdAt: new Date().toISOString(),
      };
      store.push(event);
      return event;
    },
  };
}

describe("HTR-WP16 cross-tenant isolation", () => {
  it("does not leak lifecycle state across organizations", async () => {
    const store: StrategyLifecycleEvent[] = [
      {
        id: "1",
        organizationId: "org-a",
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
    ];
    const service = createStrategyLifecycleService(isolatedRepo(store));
    expect(
      await service.getLifecycleStateAsOf(
        { organizationId: "org-a" },
        "mean_reversion_v0",
        "0.1.0",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toBe("PAPER");
    expect(
      await service.getLifecycleStateAsOf(
        { organizationId: "org-b" },
        "mean_reversion_v0",
        "0.1.0",
        "2026-01-02T00:00:00.000Z",
      ),
    ).toBeNull();
  });
});
