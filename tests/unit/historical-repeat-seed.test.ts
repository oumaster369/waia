import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { assertHistoricalSeedBeforeExecution, captureHistoricalRepeatSeed, loadHistoricalRepeatSeed,
  historicalRepeatSeedConfig, snapshotHistoricalSeedDataset, verifyHistoricalSeedDataset } from
  "../helpers/historical-repeat-seed";

const roots: string[] = [];
function directory(prefix: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix))); chmodSync(root, 0o700);
  roots.push(root); return root;
}
function paired() {
  const root = directory("waia-historical-repeat-pair-"); const seed = join(root, "seed");
  mkdirSync(seed, { mode: 0o700 });
  return { seed, env: { WAIA_LOCAL_HISTORICAL_SEED_MODE: "write", WAIA_LOCAL_HISTORICAL_SEED_DIRECTORY: seed },
    repeat: { database: "waia_hsv2_it_repeat_guard_a", output: join(root, "waia-historical-repeat-a") } };
}
function dataset() {
  const root = directory("dee-919-first-cycle-");
  mkdirSync(join(root, "BTC")); writeFileSync(join(root, "BTC", "bars.jsonl"), "source", { mode: 0o600 });
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("same-authority local seed guards", () => {
  it("refuses capture outside A and read in write mode before any database access", async () => {
    const { seed, repeat } = paired(); const sql = undefined as unknown as postgres.Sql;
    await expect(captureHistoricalRepeatSeed(sql, { ...repeat, database: "production" },
      { mode: "write", directory: seed }, "a".repeat(40), "unused", {})).rejects.toThrow(/CAPTURE_SCOPE/);
    await expect(loadHistoricalRepeatSeed(sql, { mode: "write", directory: seed }, "a".repeat(40)))
      .rejects.toThrow(/READ_MODE/);
  });
  it("refuses a changed source seal before database access", async () => {
    const { seed } = paired();
    writeFileSync(join(seed, "seed-seal.json"), JSON.stringify({
      schema: "waia.local.synthetic-pre-execution-seed.v1", sourceSha: "a".repeat(40),
    }), { mode: 0o600 });
    await expect(loadHistoricalRepeatSeed(undefined as unknown as postgres.Sql,
      { mode: "read", directory: seed }, "b".repeat(40))).rejects.toThrow(/SOURCE_MISMATCH/);
  });
  it("refuses an archive inconsistent with its retained seal", async () => {
    const { seed } = paired();
    writeFileSync(join(seed, "seed-seal.json"), JSON.stringify({
      schema: "waia.local.synthetic-pre-execution-seed.v1", sourceSha: "a".repeat(40),
      metadataSha256: "0".repeat(64),
    }), { mode: 0o600 });
    writeFileSync(join(seed, "metadata.json"), "{}", { mode: 0o600 });
    await expect(loadHistoricalRepeatSeed(undefined as unknown as postgres.Sql,
      { mode: "read", directory: seed }, "a".repeat(40))).rejects.toThrow(/ARCHIVE_CHANGED/);
  });
  it("checks all pre-execution tables and refuses any existing output", async () => {
    const visited: string[] = []; let occupied = "";
    const sql = ((query: TemplateStringsArray | string, table?: string) => {
      if (typeof query === "string") return query;
      visited.push(table!); return Promise.resolve(table === occupied ? [{ value: 1 }] : []);
    }) as unknown as postgres.Sql;
    await expect(assertHistoricalSeedBeforeExecution(sql)).resolves.toBeUndefined();
    expect(visited).toHaveLength(9); occupied = "trader_accounting_frontier";
    await expect(assertHistoricalSeedBeforeExecution(sql)).rejects.toThrow(/ALREADY_EXECUTED:trader_accounting_frontier/);
  });
  it("requires explicit paired local repeat opt-in and correct side", () => {
    expect(historicalRepeatSeedConfig({}, null)).toBeNull(); const { env, repeat, seed } = paired();
    expect(() => historicalRepeatSeedConfig(env, null)).toThrow(/PAIRED_SCOPE/);
    expect(historicalRepeatSeedConfig(env, repeat)).toEqual({ mode: "write", directory: seed });
    expect(() => historicalRepeatSeedConfig({ ...env, WAIA_LOCAL_HISTORICAL_SEED_MODE: "read" }, repeat)).toThrow();
    expect(() => historicalRepeatSeedConfig(env, { ...repeat, database: "production" })).toThrow();
    expect(() => historicalRepeatSeedConfig({ ...env, WAIA_LOCAL_HISTORICAL_SEED_MODE: "yes" }, repeat)).toThrow();
  });
  it("rejects non-private and symlink seed directories", () => {
    const { env, repeat, seed } = paired(); chmodSync(seed, 0o755);
    expect(() => historicalRepeatSeedConfig(env, repeat)).toThrow(/PRIVATE/);
    chmodSync(seed, 0o700);
    const other = paired(); rmdirSync(other.seed); symlinkSync(seed, other.seed);
    expect(() => historicalRepeatSeedConfig(other.env, other.repeat)).toThrow(/PRIVATE/);
  });
  it("binds every initial dataset file and detects equal-length content mutation", () => {
    const root = dataset(); const files = snapshotHistoricalSeedDataset(root);
    expect(files).toHaveLength(1); expect(files[0]?.bytes).toBe(6);
    expect(() => verifyHistoricalSeedDataset(root, files)).not.toThrow();
    writeFileSync(join(root, "BTC", "bars.jsonl"), "change");
    expect(() => verifyHistoricalSeedDataset(root, files)).toThrow(/CHANGED/);
  });
  it("rejects empty, duplicate and traversal bindings", () => {
    const root = dataset(); const files = snapshotHistoricalSeedDataset(root);
    expect(() => verifyHistoricalSeedDataset(root, [])).toThrow(/EMPTY/);
    expect(() => verifyHistoricalSeedDataset(root, [...files, ...files])).toThrow(/INVALID/);
    for (const path of ["../escape", "/absolute", "BTC/../bars", "BTC/./bars", "BTC//bars"]) {
      expect(() => verifyHistoricalSeedDataset(root, [{ ...files[0]!, path }])).toThrow(/INVALID/);
    }
  });
  it("rejects both leaf and intermediate symlinks even within the dataset", () => {
    const root = dataset(); const files = snapshotHistoricalSeedDataset(root);
    symlinkSync(join(root, "BTC"), join(root, "alias"));
    expect(() => snapshotHistoricalSeedDataset(root)).toThrow(/SYMLINK/);
    expect(() => verifyHistoricalSeedDataset(root, [{ ...files[0]!, path: "alias/bars.jsonl" }])).toThrow(/PATH_ESCAPE/);
    symlinkSync(join(root, "BTC", "bars.jsonl"), join(root, "leaf"));
    expect(() => verifyHistoricalSeedDataset(root, [{ ...files[0]!, path: "leaf" }])).toThrow(/PATH_ESCAPE/);
  });
  it("refuses wrong or empty dataset roots", () => {
    expect(() => snapshotHistoricalSeedDataset(directory("unrelated-"))).toThrow(/SYNTHETIC/);
    expect(() => snapshotHistoricalSeedDataset(directory("dee-919-first-cycle-"))).toThrow(/EMPTY/);
  });
});
