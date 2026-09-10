/** Separately mounted operator artifact. Never install this over frozen scientific source.
 * Launch with a clean, independently controlled Node environment and exactly
 * `node --conditions=react-server <sidecar> finalize-only <immutable-source-root>`.
 * NODE_OPTIONS preloads execute before this file; these checks cannot undo them.
 * Source mount must remain immutable through execution. node_modules/Node/OCI
 * authenticity require independent operator attestation, not an environment SHA.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCIENTIFIC_RELEASE = "90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67";
export const SOURCE_DIGEST = "e30a364be4e555f64e0299502efc203a671a0ac7699494ddfb8c74c1ae5db223";
export const SOURCE_FILE_COUNT = 2033;
export const SOURCE_PATHS = Object.freeze([
  "lib", "db", "scripts/trader/historical-simulation-v2-launch-approved.ts",
  "scripts/trader/scientific-checkpoint-store-v1.ts", "scripts/trader/validation-bootstrap-node-pool.ts",
  "scripts/trader/validation-bootstrap-range-worker.mjs",
  "services/ai-trader-execution-host/entrypoint.mjs", "services/ai-trader-execution-host/server.mjs",
  "package.json", "tsconfig.json",
]);
const refuse = code => { throw new Error(`HISTORICAL_FINALIZE_ONLY_REFUSED:${code}`); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const PHASES = new Set(["SCIENTIFIC_PREPARATION", "SURFACE_LOAD", "FORECAST_ANCHORS",
  "VALIDATION_RESAMPLES", "TECHNICAL_CANDIDATE_COMPLETE", "PROPOSAL_PERSISTED", "FINALIZATION_REPLAY"]);

export function formatProgress(event) {
  if (!event || !PHASES.has(event.phase)) return '{"phase":"UNRECOGNIZED_PROGRESS","authorityGranted":false}';
  const body = { phase: event.phase, authorityGranted: false };
  if (["BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60"].includes(event.surfaceKey)) body.surfaceKey = event.surfaceKey;
  for (const key of ["completed", "total"]) if (Number.isSafeInteger(event[key]) && event[key] >= 0) body[key] = event[key];
  return JSON.stringify(body);
}

export function formatFailure(error, verifiedFormatter) {
  if (verifiedFormatter) {
    try { return verifiedFormatter(error); } catch { /* No unredacted fallback. */ }
  }
  const message = error instanceof Error ? error.message : "";
  return /^HISTORICAL_FINALIZE_ONLY_REFUSED:[A-Z_]+$/.test(message)
    ? message : "HISTORICAL_FINALIZE_ONLY_FAILED: before verified diagnostics or diagnostic formatter unavailable";
}

/** Sorted [relative path, SHA256(file bytes)] JSON lines; includes every lib/db file.
 * Count/size bounds precede reads; symlinks (including path ancestors) are forbidden.
 * This is source verification, not a dependency/OCI attestation or a filesystem lock.
 */
export function fingerprintSource(root) {
  if (!isAbsolute(root) || resolve(root) === "/" || realpathSync(root) !== root) refuse("SOURCE_ROOT");
  const files = []; let total = 0; let entries = 0;
  const checkAncestors = relative => {
    let path = root;
    for (const part of relative.split("/")) {
      path = join(path, part);
      if (lstatSync(path).isSymbolicLink()) refuse("SOURCE_SYMLINK");
    }
  };
  const visit = relative => {
    if (++entries > 8192 || relative.split("/").length > 64) refuse("SOURCE_BOUNDS");
    const path = join(root, relative); const stat = lstatSync(path);
    if (stat.isSymbolicLink()) refuse("SOURCE_SYMLINK");
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) visit(`${relative}/${entry}`);
    } else {
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || ++total > 4096) refuse("SOURCE_BOUNDS");
      files.push(relative);
    }
  };
  for (const path of SOURCE_PATHS) { checkAncestors(path); visit(path); }
  const digest = createHash("sha256"); let bytes = 0;
  for (const path of files.sort()) {
    const size = lstatSync(join(root, path)).size;
    bytes += size; if (bytes > 128 * 1024 * 1024) refuse("SOURCE_BOUNDS");
    const contents = readFileSync(join(root, path));
    if (contents.length !== size) refuse("SOURCE_CHANGED");
    digest.update(`${JSON.stringify([path, sha256(contents)])}\n`);
  }
  return Object.freeze({ digest: digest.digest("hex"), fileCount: files.length });
}

export function verifyFrozenSource(root) {
  const actual = fingerprintSource(root);
  if (actual.digest !== SOURCE_DIGEST || actual.fileCount !== SOURCE_FILE_COUNT) refuse("SOURCE_PIN");
  return actual;
}

/** Only explicit operator intent and pinned release. Runtime guards are then loaded
 * from verified S; no caller-supplied actor, manifest, module or dependency is accepted.
 */
export function validateInvocation(args, env, execArgv) {
  if (args.length !== 2 || args[0] !== "finalize-only") refuse("EXPLICIT_ACTION");
  if (execArgv.length !== 1 || execArgv[0] !== "--conditions=react-server") refuse("NODE_ARGUMENTS");
  if (env.WAIA_RELEASE_SHA !== SCIENTIFIC_RELEASE || env.WAIA_IMAGE_RELEASE_SHA !== SCIENTIFIC_RELEASE) refuse("RELEASE_PIN");
  if (env.WAIA_EXECUTION_HOST_MODE !== "idle") refuse("SUPERVISOR_MODE");
  // The frozen runtime parser subsequently checks its complete forbidden-key list.
  if (Object.keys(env).some(key => /(?:OPERATOR|MANIFEST|RATIFICATION_JSON)/.test(key) && env[key]?.trim())) refuse("CALLER_AUTHORITY");
  return args[1];
}

/** Composition seam: production binds exclusively to verified S exports below.
 * Tests use synthetic functions without importing science or opening a database.
 */
export async function finalizeWithFrozenApi(config, api, signal, diagnostics = {}) {
  const active = () => { if (signal?.aborted) refuse("CANCELLED"); };
  active();
  const checkpoints = api.createScientificCheckpointStoreV1(config.checkpointRoot, config.releaseSha);
  const pool = api.postgres(config.databaseUrl, api.waiaCampaignPostgresDriverOptions());
  const finalized = await api.withHistoricalLaunchCleanupV2(
    () => {
      active();
      const guarded = api.guardSingleConnectionPostgresPool(pool);
      return api.withScientificCheckpointsV1(checkpoints, () => {
        active();
        return api.finalizeApprovedHistoricalProposalOnExecutionServerV2(
          api.bindHistoricalRunnerLoginGuardedPoolV2(guarded),
          { organizationId: config.organizationId, runId: config.runId, releaseSha: config.releaseSha },
          { signal, onProgress: diagnostics.onProgress, flushProgress: diagnostics.flushProgress },
        );
      });
    }, [() => pool.end({ timeout: 5 })],
  );
  active();
  if (!/^[0-9a-f-]{36}$/i.test(finalized.authorityId) || !/^[0-9a-f]{64}$/.test(finalized.manifest?.contentDigestHex)) refuse("RESULT_SHAPE");
  return Object.freeze({
    schemaVersion: "waia.historical_finalize_only_operator_result.v1",
    releaseSha: config.releaseSha, sourceDigest: SOURCE_DIGEST,
    organizationId: config.organizationId, runId: config.runId,
    authorityId: finalized.authorityId, manifestContentDigestHex: finalized.manifest.contentDigestHex,
    status: "FINALIZER_RETURNED", bootstrapInvokedByThisDriver: false,
    archiveBarrierEstablished: false, readinessGranted: false,
  });
}

/** Import-only seam, also exercised against an exact Git-S fixture in local tests.
 * Does not create checkpoints, a database client or a finalization invocation.
 */
export async function loadFrozenFinalizerApi(root) {
  verifyFrozenSource(root); // No application/dependency imports before verification.
  const sourceImport = path => import(pathToFileURL(join(root, path)).href);
  const require = createRequire(pathToFileURL(join(root, "package.json")));
  const { register: registerCjs } = await import(pathToFileURL(require.resolve("tsx/cjs/api")).href);
  const { register } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  const unregisterCjs = registerCjs();
  let unregisterEsm;
  const unregister = async () => { try { await unregisterEsm?.(); } finally { unregisterCjs(); } };
  try {
    unregisterEsm = register({ tsconfig: join(root, "tsconfig.json") });
    const paths = ["db/postgres-client.ts", "db/postgres-reserved-close-guard.ts",
      "scripts/trader/scientific-checkpoint-store-v1.ts",
      "lib/trader/historical-simulation-v2/scientific-checkpoint-context-v1.ts",
      "lib/trader/historical-simulation-v2/launch-cleanup-v2.ts",
      "lib/trader/historical-simulation-v2/launch-error-format-v2.ts",
      "lib/trader/historical-simulation-v2/ratification-split-v2.ts",
      "scripts/trader/historical-simulation-v2-launch-approved.ts"];
    const modules = [];
    for (const path of paths) {
      const imported = await sourceImport(path);
      // S is a mixed CJS/ESM graph; tsx exposes CJS named exports via default.
      modules.push({ ...(typeof imported.default === "object" ? imported.default : {}), ...imported });
    }
    const postgres = (await import(pathToFileURL(require.resolve("postgres")).href)).default;
    return { api: Object.assign({ postgres }, ...modules), unregister };
  } catch (error) { await unregister(); throw error; }
}

export async function runOperatorMain() {
  const root = validateInvocation(process.argv.slice(2), process.env, process.execArgv);
  verifyFrozenSource(root);
  const runtime = await import(pathToFileURL(join(root, "services/ai-trader-execution-host/entrypoint.mjs")).href);
  const config = runtime.parseExecutionHostRuntimeV2(process.env);
  const childEnv = runtime.buildHistoricalConsumerEnvironmentV2(process.env, config);
  // Match the frozen supervisor's allowlist before importing any scientific modules.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, childEnv);
  process.chdir(root);
  const controller = new AbortController(); const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  let loaded;
  try {
    loaded = await loadFrozenFinalizerApi(root);
    const result = await finalizeWithFrozenApi(config, loaded.api, controller.signal, {
      onProgress: event => { process.stderr.write(`${formatProgress(event)}\n`); },
      flushProgress: () => new Promise((resolve, reject) => process.stderr.write("", error => error ? reject(error) : resolve())),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${formatFailure(error, loaded?.api.formatHistoricalLaunchErrorV2)}\n`);
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await loaded?.unregister();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runOperatorMain().catch(error => {
    // Never print raw DB/import/science errors, URLs, env values or proposal bytes.
    process.stderr.write(`${formatFailure(error)}\n`);
    process.exitCode = 1;
  });
}
