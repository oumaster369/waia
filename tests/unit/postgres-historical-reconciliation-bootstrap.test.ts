// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertAppliedMigrationIdentity, assertBootstrapEndpoint, assertBootstrapJournal, assertFreshState,
  assertPrefixRows, assertPrefixSeed, expectedPrefixRows, PREFIX_SEED_SHA256, prepareHistoricalReconciliationFixture,
  readBootstrapSources } from "../../scripts/postgres-validation/prepare-historical-reconciliation-fixture";
vi.mock("postgres", () => ({ default: vi.fn(() => { throw new Error("unexpected connection"); }) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: vi.fn(() => { throw new Error("controlled migration failure"); }) }));
const local = { WAIA_POSTGRES_CLI: "1", DATABASE_URL_POSTGRES: "postgresql://waia_validate:test@127.0.0.1:54329/waia_hsv2_it_dee1130" };
const ci = { WAIA_POSTGRES_CLI: "1", CI: "true", DATABASE_URL_POSTGRES: "postgresql://waia_it:test@127.0.0.1:5432/waia_it" };
const journal = () => JSON.parse(readFileSync("db/migrations_postgres/meta/_journal.json", "utf8"));
beforeEach(() => { vi.mocked(postgres).mockClear(); });
describe("DEE1130 explicit fresh validation bootstrap admission", () => {
  it.each([local, ci, { ...local, DATABASE_URL_POSTGRES: local.DATABASE_URL_POSTGRES.replace("127.0.0.1", "localhost") }])("admits only the actual coordinated identities", env => {
    expect(assertBootstrapEndpoint(env)).toBe(env.DATABASE_URL_POSTGRES);
  });
  it.each([
    {}, { ...local, WAIA_POSTGRES_CLI: undefined }, { ...ci, CI: "false" },
    { ...local, DATABASE_URL_POSTGRES: "not a URL" },
    ...["https://waia_validate:test@127.0.0.1:54329/waia_hsv2_it_dee1130", local.DATABASE_URL_POSTGRES + "?host=remote.example",
      local.DATABASE_URL_POSTGRES + "#fragment", local.DATABASE_URL_POSTGRES + " ",
      local.DATABASE_URL_POSTGRES.replace("127.0.0.1", "db.example"), local.DATABASE_URL_POSTGRES.replace("54329", "6543"),
      local.DATABASE_URL_POSTGRES.replace("waia_hsv2_it_dee1130", "waia_validate"),
      local.DATABASE_URL_POSTGRES.replace("waia_validate:", "postgres:")].map(DATABASE_URL_POSTGRES => ({ ...local, DATABASE_URL_POSTGRES })),
  ])("refuses invalid endpoint before constructing any client", async env => {
    await expect(prepareHistoricalReconciliationFixture(env)).rejects.toThrow("DEE1130_BOOTSTRAP_REFUSED");
    expect(postgres).not.toHaveBeenCalled();
  });
  it("captures all225 actual source SQL files and exact seed bytes without any connection", () => {
    const source = readBootstrapSources();
    expect(source.migrations).toHaveLength(225);
    expect(source.migrations.slice(0, 222).at(-1)!.entry.tag).toBe("0221_trader_research_understanding_v1");
    expect(source.migrations[222]!.entry.tag).toBe("0222_trader_historical_reconciliation_v1");
    expect(source.migrations[223]!.entry).toEqual({ idx: 223, version: "7", when: 1780000000223,
      tag: "0223_trader_research_application_v1", breakpoints: true });
    expect(source.migrations[224]!.entry).toEqual({ idx: 224, version: "7", when: 1780000000224,
      tag: "0224_trader_risk_current_account_basis", breakpoints: true });
    for (const item of source.migrations) {
      expect(item.bytes).toEqual(readFileSync(`db/migrations_postgres/${item.entry.tag}.sql`));
      expect(item.identity.hash).toBe(createHash("sha256").update(item.bytes).digest("hex"));
      expect(item.identity.created_at).toBe(String(item.entry.when));
    }
    expect(createHash("sha256").update(source.seed).digest("hex")).toBe(PREFIX_SEED_SHA256);
    expect(source.prelude).toEqual(readFileSync("scripts/postgres-validation/prelude-auth-stub.sql"));
    expect(postgres).not.toHaveBeenCalled();
  });
  it.each(["missing-prefix", "extra-future", "wrong-idx", "wrong-tag", "path-traversal", "wrong-version", "wrong-breakpoints", "wrong-when", "reordered", "duplicate-when"])(
    "refuses %s before migration input can be prepared", change => {
      const value = journal();
      if (change === "missing-prefix") value.entries.splice(40, 1);
      if (change === "extra-future") value.entries.push({ ...value.entries[224], idx: 225,
        when: 1780000000225, tag: "0225_unadmitted_future_migration" });
      if (change === "wrong-idx") value.entries[222].idx = 223;
      if (change === "wrong-tag") value.entries[222].tag = "0222_unreviewed_table";
      if (change === "path-traversal") value.entries[10].tag = "../untrusted";
      if (change === "wrong-version") value.entries[20].version = "8";
      if (change === "wrong-breakpoints") value.entries[20].breakpoints = false;
      if (change === "wrong-when") value.entries[222].when++;
      if (change === "reordered") [value.entries[10], value.entries[11]] = [value.entries[11], value.entries[10]];
      if (change === "duplicate-when") value.entries[20].when = value.entries[19].when;
      expect(() => assertBootstrapJournal(value)).toThrow("JOURNAL");
    });
  it.each(["missing", "malformed", "idx", "tag", "when", "version", "breakpoints"] as const)(
    "refuses %s0223 without changing the retained222 prefix boundary", field => {
      const value = journal();
      if (field === "missing") value.entries.splice(223, 1);
      else if (field === "malformed") value.entries[223] = null;
      else if (field === "idx") value.entries[223].idx = 224;
      else if (field === "tag") value.entries[223].tag = "0223_unadmitted_application";
      else if (field === "when") value.entries[223].when++;
      else if (field === "version") value.entries[223].version = "8";
      else value.entries[223].breakpoints = false;
      expect(() => assertBootstrapJournal(value)).toThrow("JOURNAL");
    });

  it.each(["missing", "malformed", "idx", "tag", "when", "version", "breakpoints"] as const)(
    "refuses %s0224 without changing the retained223 prefix boundary", field => {
      const value = journal();
      if (field === "missing") value.entries.pop();
      else if (field === "malformed") value.entries[224] = null;
      else if (field === "idx") value.entries[224].idx = 225;
      else if (field === "tag") value.entries[224].tag = "0224_unadmitted_basis";
      else if (field === "when") value.entries[224].when++;
      else if (field === "version") value.entries[224].version = "8";
      else value.entries[224].breakpoints = false;
      expect(() => assertBootstrapJournal(value)).toThrow("JOURNAL");
    });
  it("refuses any modified seed, including whitespace, without trusting row count", () => {
    const original = readBootstrapSources().seed;
    expect(() => assertPrefixSeed(original)).not.toThrow();
    for (const altered of [Buffer.concat([original, Buffer.from("\n")]), original.subarray(1), Buffer.from("SELECT 1")]) {
      expect(() => assertPrefixSeed(altered)).toThrow("SEED_IDENTITY");
    }
  });
  it("requires exact full applied hash/when/count/order; never repairs applied history", () => {
    const expected = readBootstrapSources().migrations.map(m => m.identity);
    expect(() => assertAppliedMigrationIdentity(expected, expected)).not.toThrow();
    for (const mutated of [expected.slice(1), [...expected, expected[0]!], [...expected].reverse(),
      expected.map((r, i) => i === 100 ? { ...r, hash: "0".repeat(64) } : r),
      expected.map((r, i) => i === 100 ? { ...r, created_at: "1" } : r)]) {
      expect(() => assertAppliedMigrationIdentity(mutated, expected)).toThrow("APPLIED_MIGRATION_IDENTITY");
    }
  });
  it("requires all27 exact original-table identities, not just a success count", () => {
    const rows = expectedPrefixRows(); expect(rows).toHaveLength(27);
    const source = readBootstrapSources().seed.toString("utf8");
    for (const row of rows) { expect(source).toContain(`'${row.entry_id}'`); expect(source).toContain(`'${row.content_digest_hex}'`); }
    expect(() => assertPrefixRows(rows)).not.toThrow();
    for (const broken of [rows.slice(1), [...rows, rows[0]!], [...rows].reverse(),
      rows.map((r, i) => i === 0 ? { ...r, content_digest_hex: "0".repeat(64) } : r),
      rows.map((r, i) => i === 0 ? { ...r, account_id: "wrong" } : r)]) {
      expect(() => assertPrefixRows(broken)).toThrow("PREFIX_ROWS");
    }
  });
  it.each([
    { public_relations: 1, migration_table: null, auth_table: null },
    { public_relations: 0, migration_table: "drizzle.__drizzle_migrations", auth_table: null },
    { public_relations: 0, migration_table: null, auth_table: "auth.users" },
  ])("refuses reused state before prelude/migration/seed and closes the actual client port", async row => {
    const query = vi.fn().mockResolvedValue([row]); const end = vi.fn().mockResolvedValue(undefined);
    const unsafe = vi.fn(() => { throw new Error("unexpected mutation"); });
    const client = Object.assign(query, { end, unsafe });
    vi.mocked(postgres).mockReturnValueOnce(client as unknown as ReturnType<typeof postgres>);
    const before = readdirSync(tmpdir()).filter(n => n.startsWith("waia-dee1130-prefix-")).sort();
    await expect(prepareHistoricalReconciliationFixture(local)).rejects.toThrow("EMPTY_DATABASE_REQUIRED");
    expect(query).toHaveBeenCalledTimes(1); expect(unsafe).not.toHaveBeenCalled(); expect(end).toHaveBeenCalledTimes(1);
    expect(readdirSync(tmpdir()).filter(n => n.startsWith("waia-dee1130-prefix-")).sort()).toEqual(before);
  });
  it("removes temporary INPUT and closes the client on migrator failure, never resets the DB", async () => {
    const query = vi.fn().mockResolvedValue([{ public_relations: 0, migration_table: null, auth_table: null }]);
    const end = vi.fn().mockResolvedValue(undefined); const simple = vi.fn().mockResolvedValue(undefined);
    const unsafe = vi.fn((statement: string) => { void statement; return { simple }; });
    vi.mocked(postgres).mockReturnValueOnce(Object.assign(query, { end, unsafe }) as unknown as ReturnType<typeof postgres>);
    const before = readdirSync(tmpdir()).filter(n => n.startsWith("waia-dee1130-prefix-")).sort();
    vi.mocked(migrate).mockImplementationOnce(async (_db, config) => {
      const prefix = JSON.parse(readFileSync(join(config.migrationsFolder, "meta/_journal.json"), "utf8"));
      const actual = readBootstrapSources();
      expect(prefix.entries).toEqual(actual.journal.entries.slice(0, 222));
      expect(prefix.entries).toHaveLength(222);
      for (const source of actual.migrations) {
        expect(readFileSync(join(config.migrationsFolder, `${source.entry.tag}.sql`))).toEqual(source.bytes);
      }
      throw new Error("controlled migration failure");
    });
    await expect(prepareHistoricalReconciliationFixture(local)).rejects.toThrow("controlled migration failure");
    expect(end).toHaveBeenCalledTimes(1); expect(unsafe).toHaveBeenCalledTimes(1);
    expect(unsafe.mock.calls[0]![0]).toBe(readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8"));
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(readdirSync(tmpdir()).filter(n => n.startsWith("waia-dee1130-prefix-")).sort()).toEqual(before);
    // This is failure cleanup/ordering proof with inert ports, NOT migration success.
  });
  it("admits truly empty metadata only; absence is explicit, not truthiness", () => {
    expect(() => assertFreshState({ public_relations: 0, migration_table: null, auth_table: null })).not.toThrow();
    expect(() => assertFreshState({} as never)).toThrow("EMPTY_DATABASE_REQUIRED");
  });
});
