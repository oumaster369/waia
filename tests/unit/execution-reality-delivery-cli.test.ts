import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
const stubs = vi.hoisted(() => ({ create: vi.fn(), deliver: vi.fn(), close: vi.fn() }));
vi.mock("@/db/postgres-client", () => ({ createPerRequestPostgresRuntime: stubs.create, POSTGRES_CLOSE_GRACE_TIMEOUT_S: 5 }));
vi.mock("@/lib/trader/reality/v2/execution-report-delivery-postgres", () => ({ catchUpExecutionRealityV2Postgres: stubs.deliver }));
import { parseExecutionRealityDeliveryArgs, runExecutionRealityDeliveryCli } from "@/lib/trader/reality/v2/execution-report-delivery-cli";
const input = { organizationId: "00000000-0000-4000-8000-000000001122", accountId: "fixture-account",
  executionAttemptId: "00000000-0000-4000-8000-000000001123" };
const args = ["--organization-id", input.organizationId, "--account-id", input.accountId, "--execution-attempt-id", input.executionAttemptId];
const success = { status: "NO_REPORTS", capturedHead: { reportSequence: "0", reportDigestHex: null }, projection: null };
let write: ReturnType<typeof vi.spyOn>;
let previousExit: typeof process.exitCode;
beforeEach(() => {
  previousExit = process.exitCode;
  vi.stubEnv("WAIA_TRADER_CLI", "1"); vi.stubEnv("WAIA_DB_BACKEND", "postgres");
  vi.stubEnv("DATABASE_URL_POSTGRES", "postgres://inert-only:must-not-leak@127.0.0.1:1/unavailable");
  stubs.close.mockReset().mockResolvedValue(undefined);
  stubs.create.mockReset().mockReturnValue({ kind: "postgres", db: { inert: true }, _sql: { end: stubs.close } });
  stubs.deliver.mockReset().mockResolvedValue(success);
  write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden"); }));
});
afterEach(() => { process.exitCode = previousExit; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("DEE1122 real CLI admission and owned cleanup", () => {
  it("parses exact scope and creates one fresh client even with singleton override configured", async () => {
    vi.stubEnv("WAIA_POSTGRES_PER_REQUEST_CLIENT", "false");
    expect(parseExecutionRealityDeliveryArgs(args)).toEqual(input);
    const output = await runExecutionRealityDeliveryCli(args);
    expect(stubs.create).toHaveBeenCalledTimes(1); expect(stubs.deliver).toHaveBeenCalledWith({ inert: true }, input);
    expect(stubs.close).toHaveBeenCalledTimes(1);
    expect(stubs.close).toHaveBeenCalledWith({ timeout: 5 });
    expect(output).toEqual({ result: success, cleanup: "CLOSED" }); expect(process.exitCode).toBe(0);
    expect(write).toHaveBeenCalledTimes(1); expect(write.mock.calls[0]![0]).not.toContain("must-not-leak");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([[], args.slice(0, 4), [...args, "--account-id", "other"], [...args, "--since", "1"],
    [...args, "--reports", "{}"], [...args, "--limit", "999"]])("refuses invalid flags before allocation %j", async (values) => {
    expect((await runExecutionRealityDeliveryCli(values)).result).toMatchObject({ status: "REFUSED", code: "INVALID_INPUT" });
    expect(stubs.create).not.toHaveBeenCalled(); expect(stubs.close).not.toHaveBeenCalled(); expect(process.exitCode).toBe(2);
  });
  it.each(["0", "", "true"])("requires exact CLI gate %s before allocation", async (gate) => {
    vi.stubEnv("WAIA_TRADER_CLI", gate);
    expect((await runExecutionRealityDeliveryCli(args)).result).toMatchObject({ code: "CLI_GATE_REQUIRED" });
    expect(stubs.create).not.toHaveBeenCalled(); expect(stubs.deliver).not.toHaveBeenCalled();
  });
  it.each(["", "sqlite"])("refuses unsupported backend %s without SQLite runtime", async (backend) => {
    vi.stubEnv("WAIA_DB_BACKEND", backend);
    expect((await runExecutionRealityDeliveryCli(args)).result).toMatchObject({ code: "POSTGRES_REQUIRED" });
    expect(stubs.create).not.toHaveBeenCalled(); expect(stubs.close).not.toHaveBeenCalled();
  });
  it("refuses missing DB configuration before client creation", async () => {
    vi.stubEnv("DATABASE_URL_POSTGRES", "");
    expect((await runExecutionRealityDeliveryCli(args)).result).toMatchObject({ code: "RUNTIME_CONFIGURATION_INVALID" });
    expect(stubs.create).not.toHaveBeenCalled();
  });
  it.each([
    { status: "REFUSED", code: "DELIVERY_INCOMPLETE", newDeliveryCommitted: false },
    { status: "FAILED", code: "DELIVERY_FAILED", newDeliveryCommitted: false },
    { status: "COMMIT_OUTCOME_UNKNOWN", code: "COMMIT_OUTCOME_UNKNOWN", newDeliveryCommitted: "UNKNOWN" },
  ])("preserves command result and closes exactly once: %j", async (result) => {
    stubs.deliver.mockResolvedValue(result);
    expect(await runExecutionRealityDeliveryCli(args)).toEqual({ result, cleanup: "CLOSED" });
    expect(stubs.close).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(result.status === "REFUSED" ? 2 : 1);
  });
  it("preserves unknown commit on unexpected command rejection and still closes", async () => {
    stubs.deliver.mockRejectedValue(new Error("private failure must-not-leak"));
    expect((await runExecutionRealityDeliveryCli(args)).result).toMatchObject({ status: "COMMIT_OUTCOME_UNKNOWN", retry: "REPEAT_REPORT_DELIVERY_ONLY" });
    expect(stubs.close).toHaveBeenCalledTimes(1); expect(write.mock.calls[0]![0]).not.toContain("must-not-leak");
  });
  it("does not retry close rejection or erase an already committed outcome", async () => {
    stubs.close.mockRejectedValue(new Error("close secret"));
    expect(await runExecutionRealityDeliveryCli(args)).toEqual({ result: success, cleanup: "CLOSE_FAILED" });
    expect(stubs.close).toHaveBeenCalledTimes(1); expect(process.exitCode).toBe(1);
  });
  it("closes before output and does not retry cleanup when output fails", async () => {
    write.mockImplementation(() => { throw new Error("closed stdout"); });
    expect((await runExecutionRealityDeliveryCli(args)).cleanup).toBe("CLOSED");
    expect(stubs.close).toHaveBeenCalledTimes(1); expect(process.exitCode).toBe(1);
  });
  it("exercises the actual executable with invalid flags and no possible database endpoint", () => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--require", "./scripts/trader/trader-cli-server-only-prelude.cjs",
      "--conditions=react-server", "scripts/trader/reality-execution-report-catch-up.ts", "--unexpected"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: { ...process.env, WAIA_TRADER_CLI: "1", WAIA_DB_BACKEND: "sqlite", DATABASE_URL_POSTGRES: "" },
    });
    expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(2);
    expect(JSON.parse(child.stdout)).toEqual({ result: { status: "REFUSED", code: "INVALID_INPUT", newDeliveryCommitted: false }, cleanup: "NOT_ACQUIRED" });
  });
});
