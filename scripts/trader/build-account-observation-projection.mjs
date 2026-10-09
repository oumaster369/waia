import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const entryPoint = "scripts/trader/account-observation-projection-host.ts";
const bundleName = "account-observation-projection-host.mjs";
const manifestName = "dependency-manifest.json";
const allowedRepositoryInputs = new Set([
  entryPoint,
  "lib/trader/account-observation/database-node-tls.ts",
  "lib/trader/account-observation/derivatives/types.ts",
  "lib/trader/account-observation/host-role-probe.ts",
  "lib/trader/account-observation/postgres-reader.ts",
  "lib/trader/account-observation/projection-dispatcher.ts",
  "lib/trader/account-observation/projection-http.ts",
  "lib/trader/account-observation/projection-protocol.ts",
  "lib/trader/account-observation/projection-service-config.ts",
  "lib/trader/account-observation/projection-service.ts",
  "lib/trader/account-observation/types.ts",
  "lib/trader/account-observation/coverage.ts",
  "lib/trader/account-observation/derivatives/htx-v5-bill-groups.ts",
  "lib/trader/account-observation/validation.ts",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message) {
  throw new Error(`ACCOUNT_OBSERVATION_PROJECTION_BUILD_REFUSED:${message}`);
}

const outputArgument = process.argv[2];
if (process.argv.length > 3) fail("arguments");
const outputDirectory = outputArgument
  ? path.resolve(outputArgument)
  : path.join(repoRoot, ".tmp/projection");
const absoluteEntry = path.join(repoRoot, entryPoint);
const entryBytes = await readFile(absoluteEntry).catch(() => fail("entry point missing"));
const lockBytes = await readFile(path.join(repoRoot, "pnpm-lock.yaml"));
if (entryBytes.byteLength === 0 || lockBytes.byteLength === 0) fail("empty build input");

const buildDirectory = await mkdtemp(path.join(os.tmpdir(), "waia-projection-build-"));
const temporaryBundle = path.join(buildDirectory, bundleName);
const metafilePath = path.join(buildDirectory, "meta.json");
let metafile;
let bundleBytes;
let builderVersion;
try {
  const tsxPackagePath = realpathSync(path.join(repoRoot, "node_modules/tsx/package.json"));
  const fromTsx = createRequire(tsxPackagePath);
  const esbuildPackagePath = fromTsx.resolve("esbuild/package.json");
  const esbuildPackage = JSON.parse(await readFile(esbuildPackagePath, "utf8"));
  if (typeof esbuildPackage.version !== "string") fail("locked esbuild version missing");
  builderVersion = esbuildPackage.version;
  const esbuildPath = path.join(path.dirname(esbuildPackagePath), "bin/esbuild");
  execFileSync(esbuildPath, [
    entryPoint,
    `--outfile=${temporaryBundle}`,
    `--metafile=${metafilePath}`,
    "--bundle",
    "--packages=bundle",
    "--platform=node",
    "--format=esm",
    "--target=node22",
    "--conditions=node,react-server",
    "--tsconfig=tsconfig.json",
    "--tree-shaking=true",
    "--minify",
    "--legal-comments=none",
    "--log-level=silent",
  ], { cwd: repoRoot, stdio: "pipe" });
  metafile = JSON.parse(await readFile(metafilePath, "utf8"));
  bundleBytes = await readFile(temporaryBundle);
} catch (error) {
  const stderr = Buffer.isBuffer(error?.stderr)
    ? error.stderr.toString("utf8")
    : typeof error?.stderr === "string" ? error.stderr : "";
  const diagnostic = (stderr || String(error?.message ?? ""))
    .replaceAll(/\s+/g, " ")
    .slice(-400);
  fail(diagnostic ? `esbuild failed: ${diagnostic}` : "esbuild failed");
} finally {
  await rm(buildDirectory, { recursive: true, force: true });
}

const repositoryInputs = Object.keys(metafile.inputs)
  .map((input) => input.replaceAll("\\", "/"))
  .filter((input) => !input.startsWith("node_modules/") && !input.startsWith("<"))
  .sort();
const unexpectedInputs = repositoryInputs.filter((input) => !allowedRepositoryInputs.has(input));
if (unexpectedInputs.length) fail(`source closure: ${unexpectedInputs.join(",")}`);
if (!repositoryInputs.includes(entryPoint)) fail("entry point omitted");

if (!bundleBytes || bundleBytes.byteLength === 0) fail("bundle output missing");
const bundledText = bundleBytes.toString("utf8");
for (const marker of [
  "probeObservationCredentialPool",
  "waia_account_observation_credential_login",
  "waia_account_observation_credential",
  "SecretsStoreMasterKeyProvider",
  "WAIA_OBSERVATION_MASTER_KEY",
]) {
  if (bundledText.includes(marker)) fail(`forbidden bundled symbol: ${marker}`);
}
const packageLocators = [...new Set(await Promise.all(Object.keys(metafile.inputs)
  .map((input) => input.replaceAll("\\", "/"))
  .filter((input) => input.startsWith("node_modules/"))
  .map(async (input) => {
    const marker = input.lastIndexOf("/node_modules/");
    const packagePrefix = marker >= 0
      ? input.slice(0, marker + "/node_modules/".length)
      : "node_modules/";
    const tail = input.slice(packagePrefix.length).split("/");
    const name = tail[0]?.startsWith("@") ? `${tail[0]}/${tail[1]}` : tail[0];
    if (!name || name === ".pnpm") fail("unexpected node_modules layout");
    const packageJson = JSON.parse(
      await readFile(path.join(repoRoot, packagePrefix, name, "package.json"), "utf8"),
    );
    if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string" ||
        !lockBytes.toString("utf8").includes(`${packageJson.name}@${packageJson.version}:`)) {
      fail(`unlocked bundled dependency: ${name}`);
    }
    return `${packageJson.name}@${packageJson.version}`;
  })))].sort();
const manifest = {
  schemaVersion: "waia-account-observation-projection-dependency-manifest/v1",
  entryPoint,
  bundleFile: bundleName,
  bundleSha256: sha256(bundleBytes),
  bundleBytes: bundleBytes.byteLength,
  buildTool: `esbuild@${builderVersion}`,
  pnpmLockSha256: sha256(lockBytes),
  packageLocators,
  repositoryInputs,
};

await mkdir(outputDirectory, { recursive: true });
const bundleTemporary = path.join(outputDirectory, `.${bundleName}.${process.pid}.tmp`);
const manifestTemporary = path.join(outputDirectory, `.${manifestName}.${process.pid}.tmp`);
await writeFile(bundleTemporary, bundleBytes, { mode: 0o444 });
await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o444 });
await rename(bundleTemporary, path.join(outputDirectory, bundleName));
await rename(manifestTemporary, path.join(outputDirectory, manifestName));
