import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertSourceHashes, assertVitestProofReport, draftSql, requiredSuites, sourcePaths } from "./dee1200-postgres-proof-contract.mjs";

const root = process.cwd();
const manifestPath = resolve(root, ".tmp/dee1200-postgres-source-manifest.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (reason) => { throw new Error(`DEE1200_POSTGRES_RESULTS_REFUSED:${reason}`); };

function verifySourceManifest() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const expectedSourcePaths = [...new Set([...sourcePaths, ...requiredSuites, ...draftSql])];
  let expectedEventHead;
  if (process.env.GITHUB_EVENT_NAME === "pull_request" || process.env.GITHUB_EVENT_NAME === "pull_request_target") {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) refuse("EVENT_PAYLOAD_REQUIRED");
    expectedEventHead = JSON.parse(readFileSync(eventPath, "utf8")).pull_request?.head?.sha;
  } else {
    expectedEventHead = process.env.GITHUB_SHA;
  }
  if (manifest.schemaVersion !== "waia.dee1200.postgres-source-manifest.v1" ||
      manifest.postgresMajor !== 16 || manifest.database !== "waia_dee1159" ||
      JSON.stringify(manifest.suites) !== JSON.stringify(requiredSuites) ||
      manifest.checkoutHead !== execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() ||
      manifest.reviewedHead !== (process.env.WAIA_RELEASE_SHA ?? null) ||
      !/^[0-9a-f]{40}$/i.test(expectedEventHead ?? "") || manifest.eventHead !== expectedEventHead ||
      manifest.reviewedHead !== expectedEventHead || !Array.isArray(manifest.sourcePaths) ||
      JSON.stringify(manifest.sourcePaths) !== JSON.stringify(expectedSourcePaths)) {
    refuse("SOURCE_MANIFEST_IDENTITY");
  }
  assertSourceHashes(manifest.sourcePaths, manifest.sha256ByPath,
    (path) => readFileSync(resolve(root, path)), sha256);
}

function main() {
  if (process.argv.length !== 3) refuse("RESULTS_PATH_REQUIRED");
  verifySourceManifest();
  const report = JSON.parse(readFileSync(resolve(root, process.argv[2]), "utf8"));
  assertVitestProofReport(report);
  console.log(`Verified DEE-1200 executed PostgreSQL proof: ${requiredSuites.length} required files, all assertions passed, zero failures/skips/todos.`);
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : "DEE1200_POSTGRES_RESULTS_REFUSED:UNKNOWN");
  process.exitCode = 1;
}
