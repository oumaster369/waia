import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SCIENTIFIC_RELEASE, SOURCE_DIGEST, SOURCE_FILE_COUNT, SOURCE_PATHS,
  fingerprintSource, verifyFrozenSource, validateInvocation, finalizeWithFrozenApi, formatProgress, formatFailure,
} from "../../scripts/ops/historical-finalize-only-v1.mjs";

const config = { checkpointRoot: "/private/checkpoints", releaseSha: SCIENTIFIC_RELEASE,
  databaseUrl: "postgres://synthetic", organizationId: "organization", runId: "run" };
const env = { WAIA_RELEASE_SHA: SCIENTIFIC_RELEASE, WAIA_IMAGE_RELEASE_SHA: SCIENTIFIC_RELEASE,
  WAIA_EXECUTION_HOST_MODE: "idle" };
const authorityId = "11111111-1111-4111-8111-111111111111";
function synthetic(finalize = async () => ({ authorityId, manifest: { contentDigestHex: "a".repeat(64) } })) {
  const calls = [];
  const pool = { end: async options => { calls.push(["close", options]); } };
  const api = {
    createScientificCheckpointStoreV1: (...args) => { calls.push(["store", ...args]); return "store"; },
    waiaCampaignPostgresDriverOptions: () => ({ max: 1 }),
    postgres: (...args) => { calls.push(["pool", ...args]); return pool; },
    guardSingleConnectionPostgresPool: value => { assert.equal(value, pool); calls.push(["poolGuard"]); return value; },
    bindHistoricalRunnerLoginGuardedPoolV2: value => { assert.equal(value, pool); calls.push(["loginGuard"]); return value; },
    withScientificCheckpointsV1: async (store, fn) => { assert.equal(store, "store"); return fn(); },
    withHistoricalLaunchCleanupV2: async (fn, cleanup) => { try { return await fn(); } finally { for (const f of cleanup) await f(); } },
    finalizeApprovedHistoricalProposalOnExecutionServerV2: async (...args) => { calls.push(["finalize", ...args]); return finalize(...args); },
    bootstrap: () => assert.fail("bootstrap called"), consume: () => assert.fail("consumer called"),
  };
  return { api, calls };
}

test("explicit finalize-only invocation and immutable release required", () => {
  assert.equal(validateInvocation(["finalize-only", "/app"], env, ["--conditions=react-server"]), "/app");
  for (const args of [[], ["consume", "/app"], ["finalize-only", "/app", "--actor", "human"]]) {
    assert.throws(() => validateInvocation(args, env, ["--conditions=react-server"]), /EXPLICIT_ACTION/);
  }
  for (const patch of [{ WAIA_RELEASE_SHA: "a".repeat(40) }, { WAIA_IMAGE_RELEASE_SHA: "b".repeat(40) },
    { WAIA_EXECUTION_HOST_MODE: "historical-v2-ratified-one-shot" }, { WAIA_HISTORICAL_OPERATOR_ID: "human" },
    { WAIA_MANIFEST_PATH: "/untrusted" }]) {
    assert.throws(() => validateInvocation(["finalize-only", "/app"], { ...env, ...patch }, ["--conditions=react-server"]));
  }
  for (const argv of [[], ["--import", "evil"], ["--conditions=react-server", "--require", "evil"]]) {
    assert.throws(() => validateInvocation(["finalize-only", "/app"], env, argv), /NODE_ARGUMENTS/);
  }
});

test("exact frozen Git fingerprint and real API import-only smoke (network denied)", () => {
  const output = execFileSync("git", ["ls-tree", "-r", SCIENTIFIC_RELEASE, "--", ...SOURCE_PATHS], { encoding: "utf8" });
  const rows = output.trim().split("\n").map(line => {
    const [metadata, path] = line.split("\t"); const [mode, type, id] = metadata.split(" ");
    assert.equal(type, "blob"); assert.notEqual(mode, "120000"); return { path, id };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const bytes = execFileSync("git", ["cat-file", "--batch"], {
    input: rows.map(row => row.id).join("\n") + "\n", maxBuffer: 128 * 1024 * 1024,
  });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-finalize-frozen-import-")));
  try {
    let position = 0; const digest = createHash("sha256");
    for (const row of rows) {
      const end = bytes.indexOf(10, position); const size = Number(bytes.subarray(position, end).toString().split(" ")[2]);
      position = end + 1; const contents = bytes.subarray(position, position + size);
      const hash = createHash("sha256").update(contents).digest("hex");
      position += size + 1; digest.update(`${JSON.stringify([row.path, hash])}\n`);
      mkdirSync(dirname(join(root, row.path)), { recursive: true }); writeFileSync(join(root, row.path), contents);
    }
    assert.equal(rows.length, SOURCE_FILE_COUNT); assert.equal(digest.digest("hex"), SOURCE_DIGEST);
    assert.deepEqual(verifyFrozenSource(root), { fileCount: SOURCE_FILE_COUNT, digest: SOURCE_DIGEST });
    // Dependency symlink is outside covered source, only in this disposable import fixture.
    symlinkSync(resolve("node_modules"), join(root, "node_modules"));
    const operator = pathToFileURL(resolve("scripts/ops/historical-finalize-only-v1.mjs")).href;
    const code = `
      import assert from 'node:assert/strict';
      import net from 'node:net';
      net.Socket.prototype.connect = function () { throw new Error('NETWORK_FORBIDDEN_IN_IMPORT_TEST'); };
      const { loadFrozenFinalizerApi } = await import(${JSON.stringify(operator)});
      const runtime = await import(new URL('./services/ai-trader-execution-host/entrypoint.mjs', 'file://' + process.cwd() + '/'));
      const env = { WAIA_EXECUTION_HOST_MODE: 'idle', WAIA_IMAGE_RELEASE_SHA: ${JSON.stringify(SCIENTIFIC_RELEASE)},
        WAIA_RELEASE_SHA: ${JSON.stringify(SCIENTIFIC_RELEASE)}, DATABASE_URL_POSTGRES_SESSION: 'postgres://waia_historical_runner_login:synthetic@127.0.0.1/db',
        WAIA_HISTORICAL_ORGANIZATION_ID: '11111111-1111-4111-8111-111111111111', WAIA_HISTORICAL_RUN_ID: 'run',
        WAIA_FHV_CHECKPOINT_ROOT: '/private/synthetic-checkpoints', UNTRUSTED: 'do-not-forward' };
      const config = runtime.parseExecutionHostRuntimeV2(env);
      const allowed = runtime.buildHistoricalConsumerEnvironmentV2(env, config);
      assert.equal(allowed.UNTRUSTED, undefined); assert.equal(allowed.WAIA_TRADER_CLI, '1');
      for (const patch of [{ HTX_ACCESS_KEY: 'synthetic' }, { AI_TRADER_MASTER_KEY: 'synthetic' },
        { NODE_OPTIONS: '--require=evil' }, { WAIA_FHV_CHECKPOINT_ROOT: '/' },
        { DATABASE_URL_POSTGRES_SESSION: 'postgres://owner:synthetic@127.0.0.1/db' }]) {
        assert.throws(() => runtime.parseExecutionHostRuntimeV2({ ...env, ...patch }));
      }
      const loaded = await loadFrozenFinalizerApi(process.cwd());
      try {
        for (const name of ['postgres','waiaCampaignPostgresDriverOptions','guardSingleConnectionPostgresPool',
          'createScientificCheckpointStoreV1','withScientificCheckpointsV1','withHistoricalLaunchCleanupV2',
          'finalizeApprovedHistoricalProposalOnExecutionServerV2','bindHistoricalRunnerLoginGuardedPoolV2']) {
          assert.equal(typeof loaded.api[name], 'function', name);
        }
        const redacted = loaded.api.formatHistoricalLaunchErrorV2(new Error('postgres://user:supersecret@localhost/db TOKEN=supersecret'));
        assert.equal(redacted.includes('supersecret'), false);
        process.stdout.write('IMPORT_ONLY_PASS\\n');
      } finally { await loaded.unregister(); }
    `;
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", code], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      env: { PATH: process.env.PATH, NODE_ENV: "production", WAIA_TRADER_CLI: "1" },
    });
    assert.equal(result.status, 0, result.stderr + result.stdout); assert.equal(result.stdout, "IMPORT_ONLY_PASS\n");
  } finally { rmSync(root, { recursive: true }); }
});

test("filesystem fingerprint rejects tamper, extra files and symlink traversal", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-finalize-pin-test-")));
  try {
    for (const path of SOURCE_PATHS) {
      if (["lib", "db"].includes(path)) { mkdirSync(join(root, path)); writeFileSync(join(root, path, "test.ts"), "fixture"); }
      else { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), "fixture"); }
    }
    const before = fingerprintSource(root);
    assert.throws(() => verifyFrozenSource(root), /SOURCE_PIN/);
    writeFileSync(join(root, "lib/test.ts"), "tampered"); assert.notEqual(fingerprintSource(root).digest, before.digest);
    writeFileSync(join(root, "lib/extra.ts"), "extra"); assert.equal(fingerprintSource(root).fileCount, before.fileCount + 1);
    symlinkSync(join(root, "package.json"), join(root, "db/link.ts"));
    assert.throws(() => fingerprintSource(root), /SOURCE_SYMLINK/);
  } finally { rmSync(root, { recursive: true }); }
});

test("finalize only: exact scope, constrained pool, checkpoint context and cleanup", async () => {
  const { api, calls } = synthetic(); const controller = new AbortController();
  const result = await finalizeWithFrozenApi(config, api, controller.signal);
  const call = calls.find(([name]) => name === "finalize");
  assert.deepEqual(call[2], { organizationId: config.organizationId, runId: config.runId, releaseSha: SCIENTIFIC_RELEASE });
  assert.equal(call[3].signal, controller.signal);
  assert.deepEqual(calls.map(([name]) => name), ["store", "pool", "poolGuard", "loginGuard", "finalize", "close"]);
  assert.equal(result.status, "FINALIZER_RETURNED"); assert.equal(result.bootstrapInvokedByThisDriver, false);
  assert.equal(result.archiveBarrierEstablished, false); assert.equal(result.readinessGranted, false);
  assert.equal(JSON.stringify(result).includes(config.databaseUrl), false);
});

test("failed finalization closes pool without bootstrap or success", async () => {
  const error = new Error("private failure"); const { api, calls } = synthetic(async () => { throw error; });
  await assert.rejects(finalizeWithFrozenApi(config, api), value => value === error);
  assert.equal(calls.at(-1)[0], "close");
});

test("guard/context failures also close the already-created pool", async () => {
  for (const seam of ["guardSingleConnectionPostgresPool", "withScientificCheckpointsV1", "bindHistoricalRunnerLoginGuardedPoolV2"]) {
    const { api, calls } = synthetic(); api[seam] = () => { throw new Error("guard failure"); };
    await assert.rejects(finalizeWithFrozenApi(config, api), /guard failure/);
    assert.equal(calls.at(-1)[0], "close"); assert.equal(calls.some(([name]) => name === "finalize"), false);
  }
});

test("pre-cancel opens nothing; late cancellation preserves finalization and closes pool", async () => {
  const controller = new AbortController(); controller.abort(); const early = synthetic();
  await assert.rejects(finalizeWithFrozenApi(config, early.api, controller.signal), /CANCELLED/);
  assert.deepEqual(early.calls, []);
  const lateController = new AbortController(); const late = synthetic(async () => {
    lateController.abort(); return { authorityId, manifest: { contentDigestHex: "a".repeat(64) } };
  });
  await assert.rejects(finalizeWithFrozenApi(config, late.api, lateController.signal), /CANCELLED/);
  assert.equal(late.calls.at(-1)[0], "close");
});

test("frozen composition source contract and import-safe main guards", () => {
  const show = path => execFileSync("git", ["show", `${SCIENTIFIC_RELEASE}:${path}`], { encoding: "utf8" });
  const approved = show("scripts/trader/historical-simulation-v2-launch-approved.ts");
  for (const api of ["bindHistoricalRunnerLoginGuardedPoolV2", "createScientificCheckpointStoreV1",
    "guardSingleConnectionPostgresPool", "waiaCampaignPostgresDriverOptions", "withScientificCheckpointsV1",
    "withHistoricalLaunchCleanupV2", "finalizeApprovedHistoricalProposalOnExecutionServerV2"]) assert.ok(approved.includes(api));
  assert.ok(approved.includes('process.argv[1] === fileURLToPath(import.meta.url)'));
  const runtime = show("services/ai-trader-execution-host/entrypoint.mjs");
  assert.ok(runtime.includes("export function parseExecutionHostRuntimeV2"));
  assert.ok(runtime.includes("export function buildHistoricalConsumerEnvironmentV2"));
  assert.ok(runtime.includes("if (isMainModule())"));
  const source = readFileSync("scripts/ops/historical-finalize-only-v1.mjs", "utf8");
  assert.ok(source.indexOf("verifyFrozenSource(root); //") < source.indexOf('require.resolve("tsx/esm/api")'));
  assert.equal(/runApprovedHistoricalLaunchCliV2\(|bootstrapAndQueueHistoricalSimulationOnExecutionServerV2\(|executeQueuedHistoricalSimulationLaunchV2\(/.test(source), false);
});

test("CLI refusals are sanitized and cannot import application/initialize checkpoints", () => {
  const cli = resolve("scripts/ops/historical-finalize-only-v1.mjs");
  for (const args of [[], ["finalize-only", "/not-a-frozen-tree"]]) {
    const result = spawnSync(process.execPath, ["--conditions=react-server", cli, ...args], {
      encoding: "utf8", env: { ...env, PATH: process.env.PATH, DATABASE_URL_POSTGRES_SESSION: "postgres://private:secret@invalid/db" },
    });
    assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.match(result.stderr, /^HISTORICAL_FINALIZE_ONLY_(?:FAILED|REFUSED):/);
    assert.equal(result.stderr.includes("private"), false); assert.equal(result.stderr.includes("secret"), false);
  }
});

test("bounded allowlisted progress and safe pre-import diagnostic fallback", () => {
  assert.deepEqual(JSON.parse(formatProgress({ phase: "FINALIZATION_REPLAY", surfaceKey: "BTCUSDT:30", completed: 3,
    total: 10, secret: "hidden", organizationId: "hidden" })), {
    phase: "FINALIZATION_REPLAY", surfaceKey: "BTCUSDT:30", completed: 3, total: 10, authorityGranted: false,
  });
  for (const event of [{ phase: "secret" }, { phase: "SURFACE_LOAD", surfaceKey: "secret", total: Infinity }]) {
    assert.equal(formatProgress(event).includes("secret"), false);
  }
  assert.equal(formatFailure(new Error("postgres://user:secret@host/db")).includes("secret"), false);
  assert.equal(formatFailure(new Error("secret"), () => { throw new Error("secret"); }).includes("secret"), false);
});
