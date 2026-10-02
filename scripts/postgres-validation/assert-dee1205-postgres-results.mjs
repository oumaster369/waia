import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertExactCiDatabaseTarget, assertSourceHashes, assertVitestProofReport,
  requiredSuites, sourcePaths } from "./dee1205-postgres-proof-contract.mjs";

const root = process.cwd();
const manifestPath = resolve(root, ".tmp/dee1205-postgres-source-manifest.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (reason) => { throw new Error(`DEE1205_POSTGRES_RESULTS_REFUSED:${reason}`); };

function readEventHead() {
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.GITHUB_EVENT_NAME === "pull_request_target") {
    if (!process.env.GITHUB_EVENT_PATH) refuse("EVENT_PAYLOAD_REQUIRED");
    return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request?.head?.sha;
  }
  return process.env.GITHUB_SHA;
}

function verifyManifest() {
  assertExactCiDatabaseTarget(process.env);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const eventHead = readEventHead();
  if (manifest.schemaVersion !== "waia.dee1205.postgres-source-manifest.v1" ||
      manifest.postgresMajor !== 16 || manifest.database !== "waia_dee1205" ||
      JSON.stringify(manifest.requiredSuites) !== JSON.stringify(requiredSuites) ||
      JSON.stringify(manifest.sourcePaths) !== JSON.stringify(sourcePaths) ||
      manifest.checkoutHead !== execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() ||
      !/^[0-9a-f]{40}$/i.test(eventHead ?? "") ||
      manifest.eventHead !== eventHead || manifest.reviewedHead !== eventHead ||
      process.env.WAIA_RELEASE_SHA !== eventHead) {
    refuse("SOURCE_MANIFEST_IDENTITY");
  }
  assertSourceHashes(sourcePaths, manifest.sha256ByPath,
    (path) => readFileSync(resolve(root, path)), sha256);
}

function main() {
  if (process.argv.length !== 3) refuse("RESULTS_PATH_REQUIRED");
  verifyManifest();
  const report = JSON.parse(readFileSync(resolve(root, process.argv[2]), "utf8"));
  assertVitestProofReport(report);
  console.log("Verified DEE-1205 executed PostgreSQL proof: exact native file, all assertions passed, zero failures/skips/todos and unchanged source bytes.");
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "DEE1205_POSTGRES_RESULTS_REFUSED:UNKNOWN");
  process.exitCode = 1;
}
