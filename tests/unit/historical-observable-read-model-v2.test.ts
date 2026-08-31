import { describe, expect, it, vi } from "vitest";
import { loadHistoricalObservableProjectionPostgresV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-postgres-v2";
import { createHistoricalSimulationDurableStateSnapshotV2 } from "@/lib/trader/historical-simulation-v2/atomic-cycle-commit-v2";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";

const row = (accountId: string, equity: string, sequence: number) => {
  const body = { schemaVersion:"htr-accounting-frontier/v1" as const,engineId:"CANONICAL_CROSS_BACKEND_ACCOUNTING_ENGINE_V1" as const,
    basisMethod:"DUAL_GROSS_NET_WEIGHTED_AVERAGE_BASIS_V1" as const,organizationId:"org",accountKey:accountId,runId:"run",
    accountingSequence:sequence,frontierAsOf:"2026-01-01T00:00:00.000Z",monthKey:"2026-01",cash:equity,positions:{},
    grossRealizedPnl:"1.00000000",netRealizedPnl:"1.00000000",marks:{},markedPositionValue:"0.00000000",equity,equityHwm:equity,
    accountDrawdownBps:0,consumedFillIds:[],id:`f-${accountId}`,sourceFillId:null,sourceEconomicsDigest:"a".repeat(64),idempotencyKey:`f-${accountId}` };
  const state={...body,semanticContentDigest:computeAccountingSemanticDigest(body)};
  const snapshot=createHistoricalSimulationDurableStateSnapshotV2({organizationId:"org",accountId,runId:"run",split:"WALK_FORWARD",cycleId:`c-${sequence}`,
    stateKind:"ACCOUNTING_FRONTIER",state});
  return ({
  organization_id:"org",run_id:"run",
  account_id: accountId, cycle_sequence: sequence, cycle_id: `c-${sequence}`, symbol: "BTCUSDT",
  partition: "WALK_FORWARD", replay_bar_closed_at_utc: "2026-01-01T00:00:00.000Z",
  accounting_json: { status: "COMMITTED" },
  accounting_state_json: snapshot.state, accounting_snapshot_content_digest_hex:snapshot.contentDigestHex,
  accounting_snapshot_schema_version:snapshot.schemaVersion,accounting_snapshot_cycle_id:snapshot.cycleId,
  portfolio_json: { positions: [] }, risk_json: { status: "PERMITTED" },
  execution_json: { status: "NO_TRADE" }, decision_json: { action: "CASH" }, guardian_json: {}, learning_json: {},
  observed_execution_effects_json: [], stages: ["KNOWLEDGE"], snapshots: ["KNOWLEDGE"],
  decisions_count: sequence + 1, risk_veto_count: 0, orders_count: 0, fills_count: 0,
  committed_cycle_sequence: sequence, next_record_index: sequence + 2, next_cycle_sequence: sequence + 1,
  checkpoint_content_digest_hex: "c".repeat(64), content_digest_hex: accountId === "a" ? "a".repeat(64) : "b".repeat(64),
  });
};

describe("historical observable read model v2", () => {
  it("aggregates operator accounts without exposing a control or capital surface", async () => {
    const unsafe = vi.fn().mockResolvedValue([row("a", "100.00000000", 1), row("b", "50.00000000", 2)]);
    const result = await loadHistoricalObservableProjectionPostgresV2({ unsafe } as never,
      { organizationId: "org", runId: "run" });
    expect(result).toMatchObject({ mode: "HISTORICAL_SIMULATION", capitalEligible: false,
      aggregate: { accountCount: 2, equity: "150.00000000", decisions: 5, cycles: 5 } });
    expect(result.accounts[0]?.checkpoint?.nextCycleSequence).toBe(2);
    expect(String(unsafe.mock.calls[0]?.[0])).toContain("capital_eligible=false");
    expect(String(unsafe.mock.calls[0]?.[0])).not.toMatch(/credential|private|live_order/i);
  });

  it("binds a tenant request to the exact account in SQL", async () => {
    const unsafe = vi.fn().mockResolvedValue([row("owned", "10.00000000", 0)]);
    const result = await loadHistoricalObservableProjectionPostgresV2({ unsafe } as never,
      { organizationId: "org", runId: "run", accountId: "owned" });
    expect(unsafe.mock.calls[0]?.[1]).toEqual(["org", "run", "owned"]);
    expect(String(unsafe.mock.calls[0]?.[0])).toContain("l.account_id = $3");
    expect(result.accounts.map((item) => item.accountId)).toEqual(["owned"]);
  });
});
