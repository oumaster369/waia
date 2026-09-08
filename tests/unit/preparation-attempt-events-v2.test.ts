import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/trader/historical-simulation-v2/historical-runner-role-v2", () => ({
  requireHistoricalSimulationRunnerLoginV2: vi.fn(),
  assumeHistoricalSimulationRunnerRoleV2: vi.fn(), resetHistoricalSimulationRunnerRoleV2: vi.fn(),
}));
import { classifyPreparationFailureV2, createPreparationAttemptJournalV2, PREPARATION_JOURNAL_WRITE_DEADLINE_MS,
  readPreparationAttemptV2 } from "@/lib/trader/historical-simulation-v2/preparation-attempt-events-v2";
const scope = { organizationId: "11111111-1111-4111-8111-111111111111", runId: "prep-run",
  releaseSha: "a".repeat(40), requestId: "22222222-2222-4222-8222-222222222222",
  requestContentDigestHex: "b".repeat(64) };
function poolMock() {
  const query = vi.fn(async (...args: unknown[]) => { void args; return []; });
  const release = vi.fn();
  const reserved = Object.assign(query, { release });
  const pool = Object.assign(vi.fn(), { reserve: vi.fn(async () => reserved),
    options: { parsers: {}, serializers: {} } }) as unknown as postgres.Sql;
  return { pool, query, release };
}
describe("preparation diagnostics only", () => {
  it("publishes only a bounded public classification for sensitive and hostile failures", () => {
    expect(classifyPreparationFailureV2(new Error("password=secret postgresql://user:pass@private/db")))
      .toBe("PREPARATION_FAILED");
    expect(classifyPreparationFailureV2({ token: "secret" })).toBe("PREPARATION_FAILED");
    const hostile = new Error(); Object.defineProperty(hostile, "message", { get() { throw Error("getter"); } });
    expect(classifyPreparationFailureV2(hostile)).toBe("PREPARATION_FAILED");
    expect(classifyPreparationFailureV2(new Error("TECHNICAL_PREPARATION_CANCELLED"))).toBe("CANCELLED");
    expect(classifyPreparationFailureV2(Object.assign(new Error("private"), { code: "CONNECTION_CLOSED" })))
      .toBe("CONNECTION_LOST");
  });
  it("commits STARTED before computation, drains bounded actual progress, then FAILED with no raw error", async () => {
    const { pool, query, release } = poolMock();
    const journal = await createPreparationAttemptJournalV2(pool, scope);
    expect(query).toHaveBeenCalledOnce();
    for (let completed = 0; completed <= 100; completed++) journal.progress({
      schemaVersion: "waia.trader.technical_preparation_progress.v2", ...scope,
      phase: "VALIDATION_RESAMPLES", surfaceKey: "BTCUSDT:30", completed, total: 100,
      authorityGranted: false,
    });
    await journal.fail(new Error("password=must-not-leak"));
    const values = query.mock.calls.map(call => call.slice(1));
    expect(values[0]![7]).toBe("STARTED");
    expect(values.at(-1)![7]).toBe("FAILED");
    expect(values.at(-1)![11]).toBe("PREPARATION_FAILED");
    expect(values).toHaveLength(4); // STARTED, in-flight first, coalesced latest, FAILED
    expect(values[2]![9]).toBe(100);
    expect(JSON.stringify(values)).not.toContain("must-not-leak");
    expect(release).toHaveBeenCalledTimes(4);
    await expect(journal.complete("fake-proposal")).rejects.toThrow("ALREADY_TERMINAL");
  });
  it("refuses wrong scope and fabricated counters", async () => {
    const { pool } = poolMock(); const journal = await createPreparationAttemptJournalV2(pool, scope);
    const event = { schemaVersion: "waia.trader.technical_preparation_progress.v2" as const,
      ...scope, phase: "FORECAST_ANCHORS" as const, completed: 1, total: 10,
      authorityGranted: false as const };
    expect(() => journal.progress({ ...event, organizationId: "wrong" })).toThrow("EVENT_SCOPE");
    expect(() => journal.progress({ ...event, completed: 11 })).toThrow("EVENT_COUNTERS");
    expect(() => journal.progress({ ...event, surfaceKey: "private-path" })).toThrow("EVENT_IDENTITY");
    await journal.fail(new Error("cancel"));
  });
  it("does not continue or silently succeed after journal transport failure", async () => {
    const { pool, query } = poolMock(); const journal = await createPreparationAttemptJournalV2(pool, scope);
    const failure = new Error("diagnostic write failed"); query.mockRejectedValueOnce(failure);
    journal.progress({ schemaVersion: "waia.trader.technical_preparation_progress.v2", ...scope,
      phase: "SURFACE_LOAD", authorityGranted: false });
    await expect(journal.complete("fake-proposal")).rejects.toBe(failure);
  });
  it("bounds an unresponsive journal connection without touching the compute pool", async () => {
    vi.useFakeTimers();
    try {
      const end = vi.fn(async () => undefined);
      const pool = Object.assign(vi.fn(), { reserve: vi.fn(() => new Promise(() => {})), end }) as unknown as postgres.Sql;
      const pending = createPreparationAttemptJournalV2(pool, scope);
      const rejection = expect(pending).rejects.toThrow("PREPARATION_JOURNAL_WRITE_TIMEOUT");
      await vi.advanceTimersByTimeAsync(PREPARATION_JOURNAL_WRITE_DEADLINE_MS);
      await rejection;
      expect(end).toHaveBeenCalledOnce();
      expect(end).toHaveBeenCalledWith({ timeout: 0 });
    } finally { vi.useRealTimers(); }
  });
  it("still attempts an independent FAILED write after a progress write rejects", async () => {
    const { pool, query } = poolMock(); const journal = await createPreparationAttemptJournalV2(pool, scope);
    const failure = new Error("journal progress rejected"); query.mockRejectedValueOnce(failure);
    journal.progress({ schemaVersion: "waia.trader.technical_preparation_progress.v2", ...scope,
      phase: "SURFACE_LOAD", authorityGranted: false });
    await expect(journal.fail(new Error("primary"))).rejects.toBe(failure);
    expect(query.mock.calls.at(-1)?.[8]).toBe("FAILED");
  });
  it("reproduces a progress deadline expiring before the I/O continuation is serviced", async () => {
    vi.useFakeTimers();
    try {
      const { pool } = poolMock();
      Object.assign(pool, { end: vi.fn(async () => undefined) });
      const journal = await createPreparationAttemptJournalV2(pool, scope);
      journal.progress({ schemaVersion: "waia.trader.technical_preparation_progress.v2", ...scope,
        phase: "SURFACE_LOAD", authorityGranted: false });
      // Deliberately advance the timer without servicing promise continuations:
      // model the caller starting long synchronous CPU work immediately after progress().
      vi.advanceTimersByTime(PREPARATION_JOURNAL_WRITE_DEADLINE_MS + 1);
      await expect(journal.complete("unused")).rejects.toThrow("PREPARATION_JOURNAL_WRITE_TIMEOUT");
    } finally { vi.useRealTimers(); }
  });
  it("offers a nonterminal flush barrier before CPU work, retaining subsequent progress", async () => {
    vi.useFakeTimers();
    try {
      const { pool, query } = poolMock();
      const end = vi.fn(async () => undefined); Object.assign(pool, { end });
      const journal = await createPreparationAttemptJournalV2(pool, scope);
      journal.progress({ schemaVersion: "waia.trader.technical_preparation_progress.v2", ...scope,
        phase: "SURFACE_LOAD", authorityGranted: false });
      await journal.flush();
      vi.advanceTimersByTime(PREPARATION_JOURNAL_WRITE_DEADLINE_MS + 1);
      expect(end).not.toHaveBeenCalled();
      journal.progress({ schemaVersion: "waia.trader.technical_preparation_progress.v2", ...scope,
        phase: "FORECAST_ANCHORS", completed: 1, total: 10, authorityGranted: false });
      await journal.flush();
      await journal.complete("proposal");
      expect(query.mock.calls.at(-1)?.[8]).toBe("PROPOSAL_AVAILABLE");
    } finally { vi.useRealTimers(); }
  });
  it("binds every public read to request, digest, organization, run and release", async () => {
    const sql = vi.fn(async (...args: unknown[]) => { void args; return []; });
    expect(await readPreparationAttemptV2(sql as unknown as postgres.Sql, scope)).toBeNull();
    expect(sql.mock.calls[0]?.slice(1)).toEqual([
      scope.organizationId, scope.runId, scope.releaseSha, scope.requestId, scope.requestContentDigestHex,
      scope.organizationId, scope.runId, scope.releaseSha, scope.requestId, scope.requestContentDigestHex,
    ]);
  });
});
