import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { assertExactCiDatabaseTarget, requiredSuites, sourcePaths } from "./dee1205-postgres-proof-contract.mjs";

const root = process.cwd();
const manifestPath = resolve(root, ".tmp/dee1205-postgres-source-manifest.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (reason) => { throw new Error(`DEE1205_POSTGRES_PROOF_REFUSED:${reason}`); };

function readReviewedHead() {
  let eventHead;
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.GITHUB_EVENT_NAME === "pull_request_target") {
    if (!process.env.GITHUB_EVENT_PATH) refuse("EVENT_PAYLOAD_REQUIRED");
    eventHead = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request?.head?.sha;
  } else {
    eventHead = process.env.GITHUB_SHA;
  }
  if (!/^[0-9a-f]{40}$/i.test(eventHead ?? "") || process.env.WAIA_RELEASE_SHA !== eventHead) {
    refuse("REVIEWED_HEAD_BINDING");
  }
  return eventHead;
}

function hashSourceFiles() {
  return Object.fromEntries(sourcePaths.map((path) => {
    let bytes;
    try { bytes = readFileSync(resolve(root, path)); } catch { return refuse(`SOURCE_FILE_MISSING:${path}`); }
    if (bytes.byteLength === 0) refuse(`SOURCE_FILE_EMPTY:${path}`);
    return [path, sha256(bytes)];
  }));
}

async function main() {
  const url = assertExactCiDatabaseTarget(process.env);
  const eventHead = readReviewedHead();
  const sourceHashes = hashSourceFiles();
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const [identity] = await client`SELECT current_database() AS database_name,
      current_setting('server_version_num')::int AS server_version_num,
      current_user AS role_name,
      to_regclass('drizzle.__drizzle_migrations')::text AS migration_table,
      to_regclass('public.trader_orders')::text AS orders_table,
      to_regclass('public.trader_risk_limits')::text AS limits_table,
      to_regclass('public.trader_scheduled_noncapital_cycle_receipts_v1')::text AS receipt_table`;
    if (!identity || identity.database_name !== "waia_dee1205" ||
        identity.server_version_num < 160000 || identity.server_version_num >= 170000 ||
        identity.role_name !== "waia_it" || !identity.migration_table ||
        !identity.orders_table || !identity.limits_table || identity.receipt_table !== null) {
      refuse("FRESH_POSTGRES16_MIGRATED_DATABASE_REQUIRED");
    }
    const manifest = {
      schemaVersion: "waia.dee1205.postgres-source-manifest.v1",
      checkoutHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      reviewedHead: process.env.WAIA_RELEASE_SHA,
      eventHead,
      postgresMajor: 16,
      database: "waia_dee1205",
      requiredSuites,
      sourcePaths,
      sha256ByPath: sourceHashes,
      capturedAtUtc: new Date().toISOString(),
    };
    mkdirSync(resolve(root, ".tmp"), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log("DEE-1205 fresh PostgreSQL 16 source proof prepared for one exact native file.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "DEE1205_POSTGRES_PROOF_REFUSED:UNKNOWN");
  process.exitCode = 1;
});
