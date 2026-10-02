import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertSourceHashes, assertVitestProofReport, databaseName, draftSql, requiredSuites, sourcePaths,
} from "./dee1222-postgres-proof-contract.mjs";

const root = process.cwd();
const manifestPath = resolve(root, ".tmp/dee1222-postgres-source-manifest.json");
const resultPath = ".tmp/dee1222-postgres-results.json";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const allPaths = [...new Set([...sourcePaths, ...requiredSuites, ...draftSql])];
const refuse = reason => { throw new Error(`DEE1222_POSTGRES_RESULTS_REFUSED:${reason}`); };

function readEventHead() {
  if (["pull_request", "pull_request_target"].includes(process.env.GITHUB_EVENT_NAME)) {
    if (!process.env.GITHUB_EVENT_PATH) refuse("EVENT_PAYLOAD_REQUIRED");
    return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request?.head?.sha;
  }
  return process.env.GITHUB_SHA;
}

function verifyManifest() {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") refuse("CI_ONLY");
  const exactUrl = `postgresql://waia_it:waia_it@127.0.0.1:5432/${databaseName}`;
  if (process.env.DATABASE_URL_POSTGRES !== exactUrl || process.env.DATABASE_URL_POSTGRES_SESSION !== exactUrl ||
      process.env.WAIA_DEE1222_POSTGRES_TEST_DATABASE_URL !== exactUrl || process.env.WAIA_DB_BACKEND !== "postgres") {
    refuse("EXACT_CI_DATABASE_REQUIRED");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const eventHead = readEventHead();
  const currentHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const expectedHashes = Object.keys(manifest.sha256ByPath ?? {}).sort();
  if (manifest.schemaVersion !== "waia.dee1222.postgres-family-selection-manifest.v1" ||
      manifest.postgresMajor !== 16 || manifest.database !== databaseName || manifest.databaseRole !== "waia_it" ||
      JSON.stringify(manifest.suites) !== JSON.stringify(requiredSuites) ||
      JSON.stringify(manifest.draftSql) !== JSON.stringify(draftSql) ||
      JSON.stringify(manifest.sourcePaths) !== JSON.stringify(allPaths) ||
      JSON.stringify(expectedHashes) !== JSON.stringify([...allPaths].sort()) ||
      !/^[0-9a-f]{40}$/.test(manifest.checkoutHead ?? "") || manifest.checkoutHead !== currentHead ||
      !/^[0-9a-f]{40}$/.test(eventHead ?? "") || manifest.eventHead !== eventHead ||
      manifest.reviewedHead !== eventHead || process.env.WAIA_RELEASE_SHA !== eventHead ||
      typeof manifest.appliedAt !== "string" || !Number.isFinite(Date.parse(manifest.appliedAt))) {
    refuse("SOURCE_MANIFEST_IDENTITY");
  }
  assertSourceHashes(allPaths, manifest.sha256ByPath, path => readFileSync(resolve(root, path)), sha256);
}

function main() {
  if (process.argv.length !== 3 || process.argv[2] !== resultPath) refuse("RESULTS_PATH_REQUIRED");
  verifyManifest();
  assertVitestProofReport(JSON.parse(readFileSync(resolve(root, resultPath), "utf8")));
  console.log("Verified DEE-1222 complete DEVELOPMENT family-selection PostgreSQL proof: exact suite and case roster, source-bound disposable database, all assertions passed, zero failures/skips/todos.");
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "DEE1222_POSTGRES_RESULTS_REFUSED:UNKNOWN");
  process.exitCode = 1;
}
