import { describe, expect, it } from "vitest";
import {
  presentStrategyWorkspace,
  type StrategyEvidence,
} from "@/lib/trader/admin-console/research/strategy-workspace";
const fact = (patch: Partial<StrategyEvidence>): StrategyEvidence => ({
  organizationId: "org",
  strategyId: "strategy",
  version: "v1",
  kind: "trade",
  id: "record",
  state: "CLOSED",
  at: "2026-09-24T20:00:00Z",
  ...patch,
});
describe("strategy deployment evidence", () => {
  it("does not equate recent trades or completed tests with deployment", () => {
    const [row] = presentStrategyWorkspace(
      [fact({}), fact({ kind: "test", state: "completed" })],
      "live",
    ).filter((row) => row.strategyId === "strategy");
    expect(row).toMatchObject({
      working: false,
      recentlyWorked: true,
      tab: "working",
      deployments: [],
    });
  });
  it("never inherits an effective promotion from another version or mode", () => {
    const evidence = [fact({}), fact({ kind: "promotion", state: "EFFECTIVE", version: "v2" })];
    const live = presentStrategyWorkspace(evidence, "live");
    expect(live.find((row) => row.strategyId === "strategy" && row.version === "v1")?.working).toBe(
      false,
    );
    expect(live.find((row) => row.strategyId === "strategy" && row.version === "v2")?.working).toBe(
      true,
    );
    expect(presentStrategyWorkspace(evidence, "paper").some((row) => row.working)).toBe(false);
    expect(presentStrategyWorkspace(evidence, "history").some((row) => row.working)).toBe(false);
  });
  it("does not classify pending promotion as effective", () => {
    expect(
      presentStrategyWorkspace([fact({ kind: "promotion", state: "COOLING_OFF" })], "live").some(
        (row) => row.working,
      ),
    ).toBe(false);
  });
});
