import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import postgres from "postgres";
import { draftSql, requiredSuites as suites, sourcePaths } from "./dee1200-postgres-proof-contract.mjs";

const root = process.cwd();
const reportPath = resolve(root, ".tmp/dee1200-postgres-source-manifest.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (reason) => { throw new Error(`DEE1200_POSTGRES_PROOF_REFUSED:${reason}`); };

function readSafeUrl() {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") refuse("CI_ONLY");
  const raw = process.env.DATABASE_URL_POSTGRES;
  if (!raw || raw !== process.env.DATABASE_URL_POSTGRES_SESSION) refuse("DATABASE_URL_PAIR_REQUIRED");
  let url;
  try { url = new URL(raw); } catch { return refuse("DATABASE_URL_INVALID"); }
  if (!(["postgres:", "postgresql:"].includes(url.protocol)) ||
      url.hostname !== "127.0.0.1" || url.port !== "5432" ||
      url.username !== "waia_it" || url.password !== "waia_it" ||
      url.pathname !== "/waia_dee1159" || url.search || url.hash) {
    refuse("ISOLATED_TEST_DATABASE_REQUIRED");
  }
  return raw;
}

function readFiles() {
  const paths = [...new Set([...sourcePaths, ...suites, ...draftSql])];
  return Object.fromEntries(paths.map((path) => {
    let bytes;
    try { bytes = readFileSync(resolve(root, path)); } catch { return refuse(`REQUIRED_FILE_MISSING:${path}`); }
    if (bytes.byteLength === 0) refuse(`REQUIRED_FILE_EMPTY:${path}`);
    return [path, sha256(bytes)];
  }));
}

function readReviewedHead() {
  let expected;
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.GITHUB_EVENT_NAME === "pull_request_target") {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) refuse("EVENT_PAYLOAD_REQUIRED");
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    expected = event.pull_request?.head?.sha;
  } else {
    expected = process.env.GITHUB_SHA;
  }
  const reviewed = process.env.WAIA_RELEASE_SHA;
  if (!/^[0-9a-f]{40}$/i.test(expected ?? "") || reviewed !== expected) refuse("REVIEWED_HEAD_BINDING");
  return { reviewedHead: reviewed, eventHead: expected };
}

async function main() {
  const url = readSafeUrl();
  const hashes = readFiles();
  const { reviewedHead, eventHead } = readReviewedHead();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [identity] = await sql`SELECT current_database() AS database_name,
      current_setting('server_version_num')::int AS server_version_num,
      current_user AS role_name,
      to_regclass('drizzle.__drizzle_migrations')::text AS migration_table,
      to_regclass('public.trader_strategy_admission_family')::text AS admission_family`;
    if (!identity || identity.database_name !== "waia_dee1159" ||
        identity.server_version_num < 160000 || identity.server_version_num >= 170000 ||
        identity.role_name !== "waia_it" || !identity.migration_table || !identity.admission_family) {
      refuse("FRESH_POSTGRES16_MIGRATED_DATABASE_REQUIRED");
    }
    const targets = await sql`SELECT
      to_regclass('public.trader_research_experiments_v1')::text AS experiments,
      to_regclass('public.trader_research_attempts_v1')::text AS attempts,
      to_regclass('public.trader_research_training_diagnostics_v1')::text AS diagnostics,
      to_regclass('public.trader_admission_family_spec_size_uq')::text AS family_index`;
    if (Object.values(targets[0] ?? {}).some((value) => value !== null)) refuse("FRESH_DRAFT_SCHEMA_REQUIRED");

    await sql.begin(async (tx) => {
      for (const path of draftSql) {
        const text = readFileSync(resolve(root, path), "utf8");
        const statements = text.split(/^--> statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean);
        if (statements.length === 0) refuse(`DRAFT_SQL_EMPTY:${path}`);
        for (const statement of statements) await tx.unsafe(statement).simple();
      }
    });

    const [final] = await sql`SELECT
      to_regclass('public.trader_research_experiments_v1')::text AS experiments,
      to_regclass('public.trader_research_attempts_v1')::text AS attempts,
      to_regclass('public.trader_research_training_diagnostics_v1')::text AS diagnostics,
      to_regclass('public.trader_admission_family_spec_size_uq')::text AS family_index`;
    if (!final || Object.values(final).some((value) => value === null)) refuse("DRAFT_SCHEMA_INCOMPLETE");

    const manifest = {
      schemaVersion: "waia.dee1200.postgres-source-manifest.v1",
      checkoutHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      reviewedHead,
      eventHead,
      postgresMajor: 16,
      database: "waia_dee1159",
      suites,
      draftSql,
      sourcePaths: [...new Set([...sourcePaths, ...suites, ...draftSql])],
      sha256ByPath: hashes,
      appliedAt: new Date().toISOString(),
    };
    mkdirSync(resolve(root, ".tmp"), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(`DEE-1200 synthetic PostgreSQL 16 setup complete: ${suites.length} required suites; source manifest saved.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "DEE1200_POSTGRES_PROOF_REFUSED:UNKNOWN");
  process.exitCode = 1;
});
