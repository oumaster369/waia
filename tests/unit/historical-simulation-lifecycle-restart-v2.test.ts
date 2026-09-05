import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createHistoricalSimulationRunLifecyclePostgresV2 } from
  "@/lib/trader/historical-simulation-v2/run-lifecycle-postgres-v2";
import { buildHistoricalSimulationRunLifecycleEventV2 } from
  "@/lib/trader/historical-simulation-v2/run-lifecycle-v2";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111",
  accountId: "historical-account", runId: "restart-run",
  partition: "WALK_FORWARD" as const, symbol: "BTCUSDT" as const,
  requestedByOperatorId: "operator" };

function harness(delta = 1, phase: "RUNNING" | "QUEUED" = "RUNNING",
  firstRecordIndex: string | null = "100") {
  const event = buildHistoricalSimulationRunLifecycleEventV2({ ...scope,
    eventSequence: 1, phase, initialRecordIndex: 100,
    terminalRecordIndexExclusive: 135, qualifiedTotalCycles: 35,
    committedCycles: 0, nextCycleSequence: 0, latestCommittedCycleId: null,
    observedAt: "2026-09-05T00:00:00.000Z", errorCode: null,
    previousContentDigestHex: "a".repeat(64) });
  const sql = Object.assign(async (parts: TemplateStringsArray) => {
    const q = parts.join("?");
    if (q.includes("SELECT account_id,dataset_authority_digest_hex")) return [{
      account_id: scope.accountId, dataset_authority_digest_hex: "b".repeat(64) }];
    if (q.includes("min(record_index)")) return [{ first_record_index: firstRecordIndex }];
    if (q.includes("qualified_count")) return [{ qualified_count: "35",
      minimum_record_index: "100", maximum_record_index: "134" }];
    if (q.includes("SELECT next_cycle_sequence")) return [{ next_cycle_sequence: delta,
      next_record_index: 100 + delta, committed_cycle_id: delta === 0 ? null : "cycle-0" }];
    if (q.includes("SELECT event_json")) return [{ event_json: event }];
    if (q.includes("INSERT INTO")) throw new Error("queue must not reconcile without consumer lease");
    return [];
  }, { begin: async (_options: string, fn: (tx: postgres.Sql) => Promise<unknown>) =>
    fn(sql as unknown as postgres.Sql) });
  return { event, lifecycle: createHistoricalSimulationRunLifecyclePostgresV2(
    sql as unknown as postgres.Sql) };
}

describe("canonical queue before crash-recovery claim", () => {
  it("lets a single committed cycle ahead reach lease-owning claim without rewriting progress", async () => {
    const { lifecycle, event } = harness();
    expect(await lifecycle.queue(scope)).toEqual(event);
  });
  it("keeps already matching progress idempotent", async () => {
    const { lifecycle, event } = harness(0);
    expect(await lifecycle.queue(scope)).toEqual(event);
  });
  it.each([[2, "RUNNING"], [-1, "RUNNING"], [1, "QUEUED"]] as const)(
    "rejects progress delta %s in phase %s", async (delta, phase) => {
      await expect(harness(delta, phase).lifecycle.queue(scope)).rejects.toThrow("REFUSED");
    });
  it("does not coerce absent first PIT into record zero", async () => {
    await expect(harness(0, "RUNNING", null).lifecycle.queue(scope))
      .rejects.toThrow("INITIAL_PIT");
  });
});
