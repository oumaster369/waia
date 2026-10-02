import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import postgres from "postgres";
import { databaseName, draftSql, requiredSuites, sourcePaths } from "./dee1212-postgres-proof-contract.mjs";

const root = process.cwd();
const manifestPath = resolve(root, ".tmp/dee1212-postgres-source-manifest.json");
const allPaths = [...new Set([...sourcePaths, ...requiredSuites, ...draftSql])];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const refuse = reason => { throw new Error(`DEE1212_POSTGRES_PROOF_REFUSED:${reason}`); };

function readSafeUrl() {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") refuse("CI_ONLY");
  const raw = process.env.DATABASE_URL_POSTGRES;
  if (!raw || raw !== process.env.DATABASE_URL_POSTGRES_SESSION ||
      raw !== process.env.WAIA_DEE1212_POSTGRES_TEST_DATABASE_URL) refuse("DATABASE_URL_PAIR_REQUIRED");
  let url;
  try { url = new URL(raw); } catch { return refuse("DATABASE_URL_INVALID"); }
  if (!(url.protocol === "postgres:" || url.protocol === "postgresql:") ||
      url.hostname !== "127.0.0.1" || url.port !== "5432" || url.username !== "waia_it" ||
      url.password !== "waia_it" || url.pathname !== `/${databaseName}` || url.search || url.hash) {
    refuse("ISOLATED_TEST_DATABASE_REQUIRED");
  }
  return raw;
}

function readHashes() {
  return Object.fromEntries(allPaths.map(path => {
    let bytes;
    try { bytes = readFileSync(resolve(root, path)); } catch { return refuse(`REQUIRED_FILE_MISSING:${path}`); }
    if (bytes.length === 0) refuse(`REQUIRED_FILE_EMPTY:${path}`);
    return [path, sha256(bytes)];
  }));
}

function reviewedHead() {
  let eventHead;
  if (["pull_request", "pull_request_target"].includes(process.env.GITHUB_EVENT_NAME)) {
    if (!process.env.GITHUB_EVENT_PATH) refuse("EVENT_PAYLOAD_REQUIRED");
    eventHead = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request?.head?.sha;
  } else eventHead = process.env.GITHUB_SHA;
  if (!/^[0-9a-f]{40}$/.test(eventHead ?? "") || process.env.WAIA_RELEASE_SHA !== eventHead) {
    refuse("REVIEWED_HEAD_BINDING");
  }
  return eventHead;
}

async function main() {
  const url = readSafeUrl();
  const sha256ByPath = readHashes();
  const eventHead = reviewedHead();
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [identity] = await sql`SELECT current_database() AS database_name,
      current_setting('server_version_num')::int AS server_version_num, current_user AS role_name,
      to_regclass('drizzle.__drizzle_migrations')::text AS migration_table`;
    if (!identity || identity.database_name !== databaseName || identity.role_name !== "waia_it" ||
        identity.server_version_num < 160000 || identity.server_version_num >= 170000 || !identity.migration_table) {
      refuse("FRESH_POSTGRES16_MIGRATED_DATABASE_REQUIRED");
    }

    const [before] = await sql`SELECT
      to_regclass('public.trader_research_experiments_v1')::text AS experiments,
      to_regclass('public.trader_research_attempts_v1')::text AS attempts,
      to_regclass('public.trader_research_training_diagnostics_v1')::text AS diagnostics_v1,
      to_regclass('public.trader_research_development_source_runs_v1')::text AS source_runs,
      to_regclass('public.trader_research_issued_attempts_v2')::text AS issued_attempts,
      to_regclass('public.trader_research_issued_training_diagnostics_v2')::text AS issued_diagnostics,
      to_regprocedure('public.trader_research_source_append_only_v1()')::text AS append_function,
      (SELECT count(*)::int FROM pg_constraint WHERE conrelid=to_regclass('public.trader_research_issued_attempts_v2')
        AND conname='research_issued_attempt_diagnostic_tuple_uq') AS issued_tuple_constraint`;
    if (!before || [before.experiments, before.attempts, before.diagnostics_v1, before.source_runs,
        before.issued_attempts, before.issued_diagnostics, before.append_function].some(value => value !== null) ||
        before.issued_tuple_constraint !== 0) refuse("FRESH_DRAFT_SCHEMA_REQUIRED");

    await sql.begin(async tx => {
      for (const path of draftSql) {
        const contents = readFileSync(resolve(root, path), "utf8");
        const statements = contents.split(/^--> statement-breakpoint\s*$/m).map(part => part.trim()).filter(Boolean);
        if (!statements.length) refuse(`DRAFT_SQL_EMPTY:${path}`);
        for (const statement of statements) await tx.unsafe(statement).simple();
      }
    });

    const [post] = await sql`SELECT
      to_regclass('public.trader_research_experiments_v1')::text AS experiments,
      to_regclass('public.trader_research_attempts_v1')::text AS attempts,
      to_regclass('public.trader_research_training_diagnostics_v1')::text AS diagnostics_v1,
      to_regclass('public.trader_research_development_source_runs_v1')::text AS source_runs,
      to_regclass('public.trader_research_issued_attempts_v2')::text AS issued_attempts,
      to_regclass('public.trader_research_issued_training_diagnostics_v2')::text AS issued_diagnostics,
      to_regprocedure('public.trader_research_source_append_only_v1()')::text AS append_function,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public.trader_research_issued_training_diagnostics_v2'::regclass) AS diagnostics_rls,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='trader_research_issued_training_diagnostics_v2') AS diagnostics_policies,
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='public.trader_research_issued_training_diagnostics_v2'::regclass
        AND NOT tgisinternal AND tgname IN ('research_issued_training_diagnostic_append_only','research_issued_training_diagnostic_no_truncate')) AS diagnostics_triggers,
      (SELECT count(*)::int FROM pg_constraint WHERE conrelid='public.trader_research_issued_attempts_v2'::regclass
        AND conname='research_issued_attempt_diagnostic_tuple_uq') AS issued_tuple_constraint`;
    if (!post || [post.experiments, post.attempts, post.diagnostics_v1, post.source_runs,
        post.issued_attempts, post.issued_diagnostics, post.append_function].some(value => !value) ||
        post.diagnostics_rls !== true || post.diagnostics_policies !== 1 || post.diagnostics_triggers !== 2 ||
        post.issued_tuple_constraint !== 1) refuse("DRAFT_SCHEMA_POSTCONDITION_FAILED");

    const manifest = {
      schemaVersion: "waia.dee1212.postgres-issued-training-manifest.v1",
      checkoutHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      reviewedHead: eventHead, eventHead,
      postgresMajor: 16, database: databaseName, databaseRole: identity.role_name,
      suites: requiredSuites, draftSql, sourcePaths: allPaths, sha256ByPath,
      appliedAt: new Date().toISOString(),
    };
    mkdirSync(resolve(root, ".tmp"), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log("DEE-1212 disposable PostgreSQL 16 setup complete; exact source manifest saved.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "DEE1212_POSTGRES_PROOF_REFUSED:UNKNOWN");
  process.exitCode = 1;
});
