// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { researchPureFixture } from "../helpers/research-understanding-fixture";
import { parseSavedResearchOptions } from "@/lib/trader/paper/research-understanding-v1/cli-options";
const spies = vi.hoisted(() => ({ legacy: vi.fn(), oldOwner: vi.fn(), backend: vi.fn(), acquire: vi.fn(), dispose: vi.fn(), run: vi.fn() }));
vi.mock("../../scripts/trader/paper-bar-close-loop-legacy", () => ({ runLegacyPaperBarCloseLoop: spies.legacy }));
vi.mock("@/db/runtime-backend", () => ({ getResolvedWaiaDbRuntimeConfig: spies.backend }));
vi.mock("@/db/waia-runtime-db", () => ({ getWaiaRuntimeDb: spies.acquire, disposeWaiaRuntimeDb: spies.dispose }));
vi.mock("@/lib/trader/paper/research-understanding-v1/run-saved-research-loop", () => ({ runSavedResearchLoop: spies.run }));
vi.mock("@/lib/trader/paper/durable-noncapital/run-recorded-paper-loop-postgres-v1", () => ({ runRecordedPaperLoopPostgres: spies.oldOwner }));
import { runPaperBarCloseCli } from "../../scripts/trader/paper-bar-close-loop";
let directory: string; let args: string[];
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("WAIA_TRADER_CLI", "1"); vi.stubEnv("WAIA_POSTGRES_PER_REQUEST_CLIENT", "true");
  directory = await mkdtemp(path.join(tmpdir(), "research-cli-")); const f = researchPureFixture();
  await writeFile(path.join(directory, "assignment.json"), JSON.stringify(f.config));
  await writeFile(path.join(directory, "profile.json"), JSON.stringify(f.profileDefinition));
  args = ["--saved-research-understanding", `--assignment-file=${directory}/assignment.json`, `--profile-file=${directory}/profile.json`,
    "--start-sequence=0", "--count=2", "--lease-duration-ms=1000"];
  spies.backend.mockReturnValue({ backend: "postgres" }); spies.acquire.mockResolvedValue({ kind: "postgres", _sql: {} }); spies.run.mockResolvedValue({ status: "COMPLETE", completed: [] });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
describe("actual research CLI finite capability entry", () => {
  it("uses exact SERVICE scope and never dispatches either broader old mode", async () => {
    await runPaperBarCloseCli(args); const [pool, context, input] = spies.run.mock.calls[0]!;
    expect(pool).toBe((await spies.acquire.mock.results[0]!.value)._sql);
    expect(context).toEqual({ organizationId: researchPureFixture().session.organizationId }); expect(input.assignment).toEqual(researchPureFixture().config);
    expect(spies.dispose).toHaveBeenCalledWith(await spies.acquire.mock.results[0]!.value);
    expect(spies.legacy).not.toHaveBeenCalled(); expect(spies.oldOwner).not.toHaveBeenCalled();
  });
  it.each(["--user-id=owner", "--actor=SERVICE", "--evaluator=custom", "--durable-noncapital", "--count=2"])("refuses unowned or duplicate flag %s before acquisition", async flag => {
    await expect(runPaperBarCloseCli([...args, flag])).rejects.toThrow("INVALID_RESEARCH_FLAGS"); expect(spies.acquire).not.toHaveBeenCalled();
  });
  it.each(["false", "0", "no", "off", " FALSE "])("refuses actual singleton setting %s before constructing a pool", async flag => {
    vi.stubEnv("WAIA_POSTGRES_PER_REQUEST_CLIENT", flag);
    await expect(runPaperBarCloseCli(args)).rejects.toThrow("OWNED_POSTGRES_POOL_REQUIRED"); expect(spies.acquire).not.toHaveBeenCalled();
  });
  it("requires postgres before an acquired runtime could select SQLite", async () => {
    spies.backend.mockReturnValue({ backend: "sqlite" }); await expect(runPaperBarCloseCli(args)).rejects.toThrow("POSTGRES_REQUIRED"); expect(spies.acquire).not.toHaveBeenCalled();
  });
  it("retains incomplete status and disposes, rather than masking it as COMPLETE", async () => {
    spies.run.mockResolvedValue({ status: "LEASE_BUSY", completed: [] }); expect((await runPaperBarCloseCli(args))?.status).toBe("LEASE_BUSY"); expect(spies.dispose).toHaveBeenCalledOnce();
  });
  it("propagates an unexpected error and closes only the acquired original runtime", async () => {
    spies.run.mockRejectedValue(new Error("ACTUAL_DATABASE_FAILURE")); await expect(runPaperBarCloseCli(args)).rejects.toThrow("ACTUAL_DATABASE_FAILURE"); expect(spies.dispose).toHaveBeenCalledOnce();
  });
  it("admits existing profile ID/digest only as exact data selector", async () => {
    const f = researchPureFixture(); const selected = args.filter(a => !a.startsWith("--profile-file="));
    selected.push(`--profile-id=${f.profile.id}`, `--profile-digest=${f.profile.contentDigest}`);
    expect((await parseSavedResearchOptions(selected)).profile).toEqual({ id: f.profile.id, contentDigest: f.profile.contentDigest });
  });
  it.each(["profile", "assignment"])("refuses over-limit %s metadata before parser or runtime acquisition", async kind => {
    await writeFile(path.join(directory, `${kind}.json`), " ".repeat(kind === "profile" ? 65_537 : 131_073));
    await expect(runPaperBarCloseCli(args)).rejects.toThrow("CONFIG_FILE_LIMIT_EXCEEDED"); expect(spies.acquire).not.toHaveBeenCalled();
  });
});
