import { assertRecordedAnalysisTestDatabase } from "../helpers/recorded-paper-public-transport";
import { beforeEach, describe, expect, it, vi } from "vitest";
const spies = vi.hoisted(() => ({ legacy: vi.fn(), backend: vi.fn(), acquire: vi.fn(), dispose: vi.fn(), run: vi.fn() }));
vi.mock("../../scripts/trader/paper-bar-close-loop-legacy", () => ({ runLegacyPaperBarCloseLoop: spies.legacy }));
vi.mock("@/db/runtime-backend", () => ({ getResolvedWaiaDbRuntimeConfig: spies.backend }));
vi.mock("@/db/waia-runtime-db", () => ({ getWaiaRuntimeDb: spies.acquire, disposeWaiaRuntimeDb: spies.dispose }));
vi.mock("@/lib/trader/paper/durable-noncapital/run-recorded-paper-loop-postgres-v1", () => ({ runRecordedPaperLoopPostgres: spies.run }));
import { runPaperBarCloseCli } from "../../scripts/trader/paper-bar-close-loop";
const args = ["--durable-noncapital", "--org-id=11111111-1111-4111-8111-111111111111", "--account-key=test", "--symbol=BTC/USDT", "--session-id=test", `--release-sha=${"a".repeat(40)}`,
  "--start-sequence=0", "--max-cycles=1", "--max-packet-bytes=2000000", "--max-bars-per-interval=30", "--lease-duration-ms=1000"];
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("WAIA_TRADER_CLI", "1"); spies.backend.mockReturnValue({ backend: "postgres" }); spies.acquire.mockResolvedValue({ kind: "postgres", _sql: {} }); spies.run.mockResolvedValue({ status: "COMPLETE", completed: [] }); });
describe("DEE1121 real entry dispatch and runtime ownership", () => {
  it("refuses missing bounds before opening a runtime or constructing legacy services", async () => {
    await expect(runPaperBarCloseCli(["--durable-noncapital"])).rejects.toThrow("INVALID_NONCAPITAL_FLAGS"); expect(spies.acquire).not.toHaveBeenCalled(); expect(spies.legacy).not.toHaveBeenCalled();
  });
  it("requires postgres before getWaiaRuntimeDb can construct SQLite", async () => {
    spies.backend.mockReturnValue({ backend: "sqlite" }); await expect(runPaperBarCloseCli(args)).rejects.toThrow("POSTGRES_REQUIRED"); expect(spies.acquire).not.toHaveBeenCalled(); expect(spies.legacy).not.toHaveBeenCalled();
  });
  it("disposes the original owned runtime on successful actual mode dispatch", async () => {
    await runPaperBarCloseCli(args); expect(spies.run).toHaveBeenCalledOnce(); expect(spies.dispose).toHaveBeenCalledWith(await spies.acquire.mock.results[0]!.value); expect(spies.legacy).not.toHaveBeenCalled();
  });
  it("disposes on operational errors without constructing legacy services", async () => {
    spies.run.mockRejectedValue(new Error("database failed")); await expect(runPaperBarCloseCli(args)).rejects.toThrow("database failed"); expect(spies.dispose).toHaveBeenCalledOnce(); expect(spies.legacy).not.toHaveBeenCalled();
  });
  it("refuses singleton mode and cleans up without opening a hidden second pool", async () => {
    spies.acquire.mockResolvedValue({ kind: "postgres" }); await expect(runPaperBarCloseCli(args)).rejects.toThrow("OWNED_POSTGRES_POOL_REQUIRED"); expect(spies.dispose).toHaveBeenCalledOnce(); expect(spies.run).not.toHaveBeenCalled();
  });
  it("preserves the old mode behind an explicit separate import", async () => { await runPaperBarCloseCli([]); expect(spies.legacy).toHaveBeenCalledOnce(); expect(spies.acquire).not.toHaveBeenCalled(); });
});


describe("native proof database boundary", () => {
  const flags = { CI: "true", WAIA_PG_INTEGRATION: "1", WAIA_POSTGRES_CLI: "1" };
  it("admits the disposable local lane and exact GitHub service only", () => {
    expect(() => assertRecordedAnalysisTestDatabase("postgres://waia_validate:x@127.0.0.1:54329/waia_dee1121_r2", {})).not.toThrow();
    expect(() => assertRecordedAnalysisTestDatabase("postgres://waia_it:x@127.0.0.1:5432/waia_it", flags)).not.toThrow();
  });
  it.each([
    ["postgres://waia_validate:x@127.0.0.1:54329/waia_validate", flags],
    ["postgres://waia_it:x@127.0.0.1:5432/waia_it", {}],
    ["postgres://waia_it:x@remote.invalid:5432/waia_it", flags],
    ["postgres://waia_it:x@127.0.0.1:54329/waia_it", flags],
    ["postgres://admin:x@127.0.0.1:5432/waia_it", flags],
    ["postgres://waia_it:x@127.0.0.1:5432/waia_it", { ...flags, WAIA_PG_INTEGRATION: "0" }],
    ["postgres://waia_it:x@127.0.0.1:5432/waia_it", { ...flags, WAIA_POSTGRES_CLI: "0" }],
  ])("refuses a mismatched proof identity %s", (url, env) => {
    expect(() => assertRecordedAnalysisTestDatabase(url as string, env as NodeJS.ProcessEnv)).toThrow("ISOLATED_LOOPBACK_REQUIRED");
  });
});
