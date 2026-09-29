/** Disposable validation bootstrap, never a production migration/recovery tool.
 * Exact old prefix → original-table fixture → real full-journal migrator.
 * No .env loading, supplied database port, journal repair or successful skip.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "../..");
const fixturePath = join(scriptDirectory, "fixtures/dee1130-pre0222-prefix.sql");
const preludePath = join(scriptDirectory, "prelude-auth-stub.sql");
export const PREFIX_SEED_SHA256 = "43cc41299357a65412fa0bd2405b8dc0b6ae886f4e7e387476d4c60d1c0775b8";
const organizationId = "00000000-0000-4000-8000-000000002222";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
class BootstrapRefusal extends Error {
  constructor(readonly reason: string) { super(`DEE1130_BOOTSTRAP_REFUSED:${reason}`); }
}
const refuse: (reason: string) => never = reason => { throw new BootstrapRefusal(reason); };
type Entry = Readonly<{ idx: number; version: "7"; when: number; tag: string; breakpoints: true }>;
type Journal = Readonly<{ version: "7"; dialect: "postgresql"; entries: readonly Entry[] }>;
export type MigrationIdentity = Readonly<{ hash: string; created_at: string }>;

export function assertBootstrapEndpoint(env: Readonly<Record<string, string | undefined>>): string {
  if (env.WAIA_POSTGRES_CLI !== "1") refuse("CLI_REQUIRED");
  const text = env.DATABASE_URL_POSTGRES;
  if (!text || text !== text.trim()) refuse("URL_REQUIRED");
  let url: URL;
  try { url = new URL(text); } catch { return refuse("URL_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) refuse("ISOLATED_ENDPOINT_REQUIRED");
  const local = url.username === "waia_validate" && url.port === "54329" && /^\/waia_hsv2_it(?:_[a-z0-9]+)*$/.test(url.pathname);
  const ci = env.CI === "true" && url.username === "waia_it" && url.port === "5432" && url.pathname === "/waia_it";
  if (!local && !ci) refuse("ISOLATED_ENDPOINT_REQUIRED");
  return text;
}
export function assertBootstrapJournal(value: unknown): Journal {
  if (!value || typeof value !== "object") return refuse("JOURNAL_SHAPE");
  const j = value as Partial<Journal>;
  if (j.version !== "7" || j.dialect !== "postgresql" || !Array.isArray(j.entries) || j.entries.length !== 227) refuse("JOURNAL_BOUNDARY");
  const entries = j.entries!;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.idx !== i || entry.version !== "7" || entry.breakpoints !== true ||
      !Number.isSafeInteger(entry.when) || entry.when <= 0 || (i > 0 && entry.when <= entries[i - 1]!.when) ||
      typeof entry.tag !== "string" || !new RegExp(`^${String(i).padStart(4, "0")}_[a-z0-9_]+$`).test(entry.tag)) refuse("JOURNAL_IDENTITY");
  }
  if (entries[221]!.tag !== "0221_trader_research_understanding_v1" || entries[221]!.when !== 1780000000221 ||
    entries[222]!.tag !== "0222_trader_historical_reconciliation_v1" || entries[222]!.when !== 1780000000222 ||
    entries[223]!.tag !== "0223_trader_research_application_v1" || entries[223]!.when !== 1780000000223 ||
    entries[224]!.tag !== "0224_trader_risk_current_account_basis" || entries[224]!.when !== 1780000000224 ||
    entries[225]!.tag !== "0225_trader_noncapital_domain_ownership_v1" || entries[225]!.when !== 1780000000225 ||
    entries[226]!.tag !== "0226_trader_live_capital_envelope_v2" || entries[226]!.when !== 1780000000226) refuse("JOURNAL_BOUNDARY");
  return { version: "7", dialect: "postgresql", entries: entries.map(e => ({ ...e })) };
}
export function assertPrefixSeed(value: Uint8Array): void {
  if (hash(value) !== PREFIX_SEED_SHA256) refuse("SEED_IDENTITY");
}
export function assertAppliedMigrationIdentity(actual: readonly MigrationIdentity[], expected: readonly MigrationIdentity[]): void {
  if (actual.length !== expected.length || actual.some((row, i) => row.hash !== expected[i]!.hash ||
    row.created_at !== expected[i]!.created_at)) refuse("APPLIED_MIGRATION_IDENTITY");
}
export function expectedPrefixRows() {
  return ["stage", "snapshot", "checkpoint"].flatMap(target => ["rc", "rr", "ssi"].flatMap(isolation =>
    ["commit", "rollback", "profile_race"].map(action => {
      const runId = `dee1130-pre222-${target}-${isolation}-${action}`;
      return { entry_id: `${runId}:entry:0`, organization_id: organizationId, account_id: `account:${runId}`,
        run_id: runId, cycle_id: `${runId}:cycle:0`, cycle_sequence: 0, symbol: "BTC/USDT", partition: "DEVELOPMENT",
        capital_eligible: false, content_digest_hex: hash(runId), dataset_membership_content_digest_hex: hash(runId) };
    }))).sort((a, b) => a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0);
}
export function assertPrefixRows(rows: readonly Record<string, unknown>[]): void {
  const expected = expectedPrefixRows();
  if (rows.length !== expected.length || rows.some((row, i) => Object.entries(expected[i]!).some(([key, value]) => row[key] !== value))) refuse("PREFIX_ROWS");
}
/** Pure disk admission: captures exact bytes before creating a client. Paths are
 * internal constants; no arbitrary journal/seed/SQL provider is accepted. */
export function readBootstrapSources() {
  const directory = join(root, "db/migrations_postgres");
  const journal = assertBootstrapJournal(JSON.parse(readFileSync(join(directory, "meta/_journal.json"), "utf8")));
  const migrations = journal.entries.map(entry => {
    const bytes = readFileSync(join(directory, `${entry.tag}.sql`));
    if (bytes.length === 0) refuse("EMPTY_MIGRATION");
    return { entry, bytes, identity: { hash: hash(bytes), created_at: String(entry.when) } };
  });
  const seed = readFileSync(fixturePath); assertPrefixSeed(seed);
  const prelude = readFileSync(preludePath);
  return { journal, migrations, seed, prelude };
}
export function assertFreshState(row: Readonly<{ public_relations: number; migration_table: string | null; auth_table: string | null }>): void {
  if (row.public_relations !== 0 || row.migration_table !== null || row.auth_table !== null) refuse("EMPTY_DATABASE_REQUIRED");
}
async function assertNoMode(sql: postgres.Sql): Promise<void> {
  const [row] = await sql`SELECT to_regclass('public.trader_historical_reconciliation_scope_mode_v1')::text AS mode_table`;
  if (!row || row.mode_table !== null) refuse("PREFIX_MUST_PRECEDE_0222");
}
async function readApplied(sql: postgres.Sql): Promise<MigrationIdentity[]> {
  return Array.from(await sql<MigrationIdentity[]>`SELECT hash,created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id`);
}
async function readPrefix(sql: postgres.Sql): Promise<Record<string, unknown>[]> {
  return Array.from(await sql<Record<string, unknown>[]>`SELECT entry_id,organization_id::text AS organization_id,account_id,run_id,cycle_id,cycle_sequence,
    symbol,partition,capital_eligible,content_digest_hex,dataset_membership_content_digest_hex
    FROM public.trader_historical_simulation_reason_ledger_v2 ORDER BY run_id COLLATE "C" LIMIT 28`);
}
export async function prepareHistoricalReconciliationFixture(env: Readonly<Record<string, string | undefined>> = process.env) {
  const url = assertBootstrapEndpoint(env);
  const source = readBootstrapSources();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  let temporary: string | undefined;
  try {
    const [fresh] = await sql`SELECT (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S')) AS public_relations,
      to_regclass('drizzle.__drizzle_migrations')::text AS migration_table,to_regclass('auth.users')::text AS auth_table`;
    if (!fresh) refuse("EMPTY_DATABASE_REQUIRED");
    assertFreshState(fresh as Parameters<typeof assertFreshState>[0]);
    // Only now may the original prelude mutate this admitted fresh database.
    await sql.unsafe(source.prelude.toString("utf8")).simple();
    temporary = mkdtempSync(join(tmpdir(), "waia-dee1130-prefix-"));
    mkdirSync(join(temporary, "meta"));
    for (const migration of source.migrations) writeFileSync(join(temporary, `${migration.entry.tag}.sql`), migration.bytes);
    const journalPath = join(temporary, "meta/_journal.json");
    writeFileSync(journalPath, JSON.stringify({ ...source.journal, entries: source.journal.entries.slice(0, 222) }));
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: temporary });
    const prefix = await readApplied(sql);
    assertAppliedMigrationIdentity(prefix, source.migrations.slice(0, 222).map(m => m.identity));
    await assertNoMode(sql);
    await sql.unsafe(source.seed.toString("utf8")).simple();
    assertPrefixRows(await readPrefix(sql));
    await assertNoMode(sql);
    // Only the private migrator INPUT changes. Applied/source histories do not.
    writeFileSync(journalPath, JSON.stringify(source.journal));
    await migrate(db, { migrationsFolder: temporary });
    const applied = await readApplied(sql);
    assertAppliedMigrationIdentity(applied, source.migrations.map(m => m.identity));
    assertPrefixRows(await readPrefix(sql));
    const [mode] = await sql`SELECT count(*)::int AS n FROM public.trader_historical_reconciliation_scope_mode_v1`;
    if (mode?.n !== 0) refuse("UNEXPECTED_MODE_ROWS");
    return { schemaVersion: "dee1130-validation-bootstrap/v1", prefixMigrations: prefix, appliedMigrations: applied,
      seedSha256: PREFIX_SEED_SHA256, prefixScopes: expectedPrefixRows(), databaseRetained: true };
  } finally {
    try { await sql.end({ timeout: 5 }); }
    finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  prepareHistoricalReconciliationFixture().then(receipt => { console.log(JSON.stringify(receipt)); }).catch((error: unknown) => {
    // Never log URL, credentials, raw connection errors or SQL payloads.
    console.error(error instanceof BootstrapRefusal ? error.message : "DEE1130_BOOTSTRAP_FAILED");
    process.exitCode = 1;
  });
}
