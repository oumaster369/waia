import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  SCIENTIFIC_RELEASE, SOURCE_DIGEST, SOURCE_FILE_COUNT, SOURCE_PATHS,
  fingerprintSource, verifyFrozenSource, validateInvocation, finalizeWithFrozenApi, formatProgress, formatFailure,
  STRICT_RESOLVER_CONTRACT_VERSION, digestReleaseBindingBody, parseReleaseBindingManifest,
  fingerprintCoveredSource, verifyManifestBoundSource, validateManifestBoundInvocation,
  finalizeWithManifestBoundApi,
  REQUIRED_HUMAN_RATIFICATION_ACTION, HISTORICAL_FINALIZE_OPR_RESULT_SCHEMA_V2,
  validateManifestBoundFinalizationInvocationV1, validateManifestBoundFinalizationEnvironmentV1,
  loadManifestBoundFinalizerApiV1, assertPersistedHistoricalApprovalV1,
  finalizeBoundHistoricalProposalV1, finalizeHistoricalProposalWithVerifiedOprBindingV1,
} from "../../scripts/ops/historical-finalize-only-v1.mjs";
import {
  PRESERVED_ORIGIN_RELEASE_SHA_V1, PRESERVED_ORIGIN_RUNTIME_V1,
  fingerprintHistoricalCoveredSourceV1, parseHistoricalOprBindingManifestV1,
  readHistoricalOprBindingManifestV1, serializeHistoricalOprBindingManifestV1,
  verifyHistoricalOprReleaseBindingV1,
} from "../../scripts/ops/historical-release-binding-v1.mjs";

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


const SYNTHETIC_RELEASE = "dddddddddddddddddddddddddddddddddddddddd";
function writeBindingFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-release-binding-")));
  mkdirSync(join(root, "lib"));
  writeFileSync(join(root, "lib/a.ts"), "alpha");
  const covered = fingerprintCoveredSource(root, ["lib"]);
  const body = {
    releaseSha: SYNTHETIC_RELEASE,
    sourceTreeDigest: covered.digest,
    coveredSourceDigest: covered.digest,
    coveredSourceFileCount: covered.fileCount,
    coveredSourcePaths: ["lib"],
    evaluatorIdentity: { releaseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      runtime: { node: "v22.24.0", os: "linux", arch: "x64" } },
    runtimeIdentity: { node: process.version, os: process.platform, arch: process.arch },
    strictResolverContractVersion: STRICT_RESOLVER_CONTRACT_VERSION,
  };
  const digest = digestReleaseBindingBody(body);
  const manifestPath = join(root, "release-binding.json");
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: "waia.historical_release_binding.v1", body, digest }));
  return { root, body, digest, manifestPath, covered };
}

test("generic release-binding operator refuses release, image, digest, file-count and manifest-digest mismatch", () => {
  const fixture = writeBindingFixture();
  try {
    const parsed = parseReleaseBindingManifest(readFileSync(fixture.manifestPath));
    assert.equal(parsed.releaseSha, SYNTHETIC_RELEASE);
    assert.deepEqual(verifyManifestBoundSource(fixture.root, parsed), fixture.covered);
    const env = {
      WAIA_RELEASE_SHA: SYNTHETIC_RELEASE, WAIA_IMAGE_RELEASE_SHA: SYNTHETIC_RELEASE,
      WAIA_EXECUTION_HOST_MODE: "idle",
    };
    const invocation = validateManifestBoundInvocation(
      ["finalize-only", fixture.root, "--release-binding", fixture.manifestPath], env, ["--conditions=react-server"]);
    assert.equal(invocation.manifest.releaseSha, SYNTHETIC_RELEASE);

    assert.throws(() => validateManifestBoundInvocation(
      ["finalize-only", fixture.root, "--release-binding", fixture.manifestPath],
      { ...env, WAIA_RELEASE_SHA: "e".repeat(40) }, ["--conditions=react-server"]), /RELEASE_PIN/);
    assert.throws(() => validateManifestBoundInvocation(
      ["finalize-only", fixture.root, "--release-binding", fixture.manifestPath],
      { ...env, WAIA_IMAGE_RELEASE_SHA: "e".repeat(40) }, ["--conditions=react-server"]), /IMAGE_RELEASE_PIN/);
    assert.throws(() => validateManifestBoundInvocation(
      ["finalize-only", fixture.root, "--release-binding", fixture.manifestPath],
      { ...env, WAIA_RELEASE_SHA: "main", WAIA_IMAGE_RELEASE_SHA: "latest" },
      ["--conditions=react-server"]), /RELEASE_PIN|IMPLICIT_RELEASE/);

    const digestMismatch = { ...parsed, coveredSourceDigest: "f".repeat(64) };
    assert.throws(() => verifyManifestBoundSource(fixture.root, digestMismatch), /COVERED_SOURCE_DIGEST/);
    const countMismatch = { ...parsed, coveredSourceFileCount: parsed.coveredSourceFileCount + 1 };
    assert.throws(() => verifyManifestBoundSource(fixture.root, countMismatch), /COVERED_SOURCE_FILE_COUNT/);

    const tampered = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    tampered.digest = "0".repeat(64);
    assert.throws(() => parseReleaseBindingManifest(JSON.stringify(tampered)), /MANIFEST_DIGEST/);
  } finally { rmSync(fixture.root, { recursive: true }); }
});

test("generic finalize binds the strict resolver and never creates a get-or-build store", async () => {
  const fixture = writeBindingFixture();
  try {
    const calls = [];
    const pool = { end: async options => { calls.push(["close", options]); } };
    const api = {
      createScientificCheckpointStoreV1: () => { assert.fail("get-or-build store"); },
      createStrictScientificEvidenceResolverV1: graph => { calls.push(["resolver", graph]); return "resolver"; },
      waiaCampaignPostgresDriverOptions: () => ({ max: 1 }),
      postgres: () => { calls.push(["pool"]); return pool; },
      guardSingleConnectionPostgresPool: value => value,
      bindHistoricalRunnerLoginGuardedPoolV2: value => value,
      withStrictScientificResolverV1: async (resolver, fn) => { assert.equal(resolver, "resolver"); return fn(); },
      withHistoricalLaunchCleanupV2: async (fn, cleanup) => { try { return await fn(); } finally { for (const f of cleanup) await f(); } },
      finalizeApprovedHistoricalProposalOnExecutionServerV2: async () => {
        calls.push(["finalize"]);
        return { authorityId: "11111111-1111-4111-8111-111111111111", manifest: { contentDigestHex: "a".repeat(64) } };
      },
    };
    const manifest = parseReleaseBindingManifest(readFileSync(fixture.manifestPath));
    const result = await finalizeWithManifestBoundApi({
      databaseUrl: "postgres://synthetic", organizationId: "organization", runId: "run",
      releaseSha: SYNTHETIC_RELEASE, manifest, evidenceGraph: { origin: "o", evaluator: "r" },
    }, api);
    assert.equal(result.bootstrapInvokedByThisDriver, false);
    assert.equal(result.strictResolverContractVersion, STRICT_RESOLVER_CONTRACT_VERSION);
    assert.deepEqual(calls.map(([name]) => name), ["resolver", "pool", "finalize", "close"]);
  } finally { rmSync(fixture.root, { recursive: true }); }
});

const evaluatorSourcePaths = [
  "db", "lib", "package.json", "scripts/trader/scientific-checkpoint-key-v1.ts",
  "scripts/trader/scientific-evidence-resolver-v1.ts", "tsconfig.json",
];
const organizationId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const ratificationId = "33333333-3333-4333-8333-333333333333";
const proposalDigest = "a".repeat(64);
const ratificationDigest = "b".repeat(64);

function git(root, args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options,
  }).trim();
}

function writeFiles(root, files) {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
}

function createSyntheticRepository(parent, name, files) {
  const root = join(parent, name);
  mkdirSync(root);
  execFileSync("git", ["init", "-q", root]);
  writeFiles(root, files);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=WAIA Test", "-c", "user.email=test@waia.invalid", "commit", "-q", "-m", name], {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: name === "producer-source" ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z",
      GIT_COMMITTER_DATE: name === "producer-source" ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z",
    },
  });
  return realpathSync(root);
}

function createOriginRepository(parent) {
  const root = join(parent, "origin-source");
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", process.cwd(), root]);
  git(root, ["checkout", "-q", "--detach", PRESERVED_ORIGIN_RELEASE_SHA_V1]);
  return realpathSync(root);
}

function createEvidenceRoot(parent, name, byte) {
  const root = join(parent, `${name}-evidence`);
  mkdirSync(root, { mode: 0o700 });
  const key = Buffer.alloc(32, byte);
  writeFileSync(join(root, ".seal-key"), key, { mode: 0o600 });
  chmodSync(root, 0o700);
  return { root: realpathSync(root), sealKeyDigest: createHash("sha256").update(key).digest("hex") };
}

function sourceBinding(root, paths) {
  const covered = fingerprintHistoricalCoveredSourceV1(root, paths);
  return {
    root, gitTreeSha: git(root, ["rev-parse", "HEAD^{tree}"]),
    coveredSourceDigest: covered.digest, coveredSourceFileCount: covered.fileCount,
    coveredSourcePaths: paths,
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function parsedBinding(body) {
  const bytes = serializeHistoricalOprBindingManifestV1(body);
  const digest = JSON.parse(bytes).digest;
  return { binding: parseHistoricalOprBindingManifestV1(bytes, digest), bytes, digest };
}

function createOprFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-dee1013-")));
  const originRoot = createOriginRepository(root);
  const producerRoot = createSyntheticRepository(root, "producer-source", { "producer.txt": "producer" });
  const evaluatorRoot = createSyntheticRepository(root, "evaluator-source", {
    db: "db source", lib: "lib source", "package.json": "{}\n",
    "scripts/trader/scientific-checkpoint-key-v1.ts": "export const key = 1;\n",
    "scripts/trader/scientific-evidence-resolver-v1.ts": "export const resolver = 1;\n",
    "tsconfig.json": "{}\n",
  });
  const originEvidence = createEvidenceRoot(root, "origin", 1);
  const producerEvidence = createEvidenceRoot(root, "producer", 2);
  const evaluatorEvidence = createEvidenceRoot(root, "evaluator", 3);
  const producerRelease = git(producerRoot, ["rev-parse", "HEAD"]);
  const evaluatorRelease = git(evaluatorRoot, ["rev-parse", "HEAD"]);
  const evaluatorRuntime = { node: process.version, os: process.platform, arch: process.arch };
  const body = {
    strictResolverContractVersion: STRICT_RESOLVER_CONTRACT_VERSION,
    proposalIdentity: { organizationId, runId: "historical-finalize-1", releaseSha: evaluatorRelease },
    namespaces: {
      origin: {
        releaseSha: PRESERVED_ORIGIN_RELEASE_SHA_V1, runtime: PRESERVED_ORIGIN_RUNTIME_V1,
        source: sourceBinding(originRoot, ["package.json"]), evidence: originEvidence,
      },
      producer: {
        releaseSha: producerRelease, runtime: { node: "v22.23.2", os: "linux", arch: "x64" },
        source: sourceBinding(producerRoot, ["producer.txt"]), evidence: producerEvidence,
      },
      evaluator: {
        releaseSha: evaluatorRelease, runtime: evaluatorRuntime,
        source: sourceBinding(evaluatorRoot, evaluatorSourcePaths), evidence: evaluatorEvidence,
      },
    },
  };
  const parsed = parsedBinding(body);
  const manifestPath = join(root, "binding.json");
  writeFileSync(manifestPath, parsed.bytes, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  return { root, body, ...parsed, manifestPath: realpathSync(manifestPath), producerRoot };
}

function validFinalizationEnvironment(body) {
  return {
    WAIA_TRADER_CLI: "1", WAIA_EXECUTION_HOST_MODE: "idle",
    WAIA_RELEASE_SHA: body.namespaces.evaluator.releaseSha,
    WAIA_IMAGE_RELEASE_SHA: body.namespaces.evaluator.releaseSha,
    WAIA_HISTORICAL_ORGANIZATION_ID: body.proposalIdentity.organizationId,
    WAIA_HISTORICAL_RUN_ID: body.proposalIdentity.runId,
    DATABASE_URL_POSTGRES_SESSION: "postgres://waia_historical_runner_login:synthetic@127.0.0.1/db",
  };
}

function identitiesFrom(binding) {
  return Object.fromEntries(Object.entries(binding.namespaces).map(([name, namespace]) => [
    name, { releaseSha: namespace.releaseSha, runtime: namespace.runtime },
  ]));
}

function syntheticOprApi(binding, calls, options = {}) {
  const identities = identitiesFrom(binding);
  const proposalRow = options.proposalRows ?? [{
    id: proposalId, proposal_json: {
      organizationId: binding.proposalIdentity.organizationId,
      runId: binding.proposalIdentity.runId,
      releaseSha: binding.namespaces.evaluator.releaseSha,
      contentDigestHex: proposalDigest,
    }, content_digest_hex: proposalDigest,
  }];
  const ratificationRow = options.ratificationRows ?? [{
    id: ratificationId, operator_user_id: organizationId, ratification_json: {
      schemaVersion: "waia.trader.historical_proposal_ratification.v2",
      organizationId: binding.proposalIdentity.organizationId,
      runId: binding.proposalIdentity.runId,
      releaseSha: binding.namespaces.evaluator.releaseSha,
      proposalId, proposalContentDigestHex: proposalDigest,
      operatorUserId: organizationId,
      humanDecision: REQUIRED_HUMAN_RATIFICATION_ACTION,
      contentDigestHex: ratificationDigest,
    }, content_digest_hex: ratificationDigest,
  }];
  const sql = async (strings) => {
    const text = strings.join("?");
    calls.push(["sql", text]);
    if (text.includes("trader_historical_technical_proposal_v2")) return proposalRow;
    if (text.includes("trader_historical_proposal_ratification_v2")) return ratificationRow;
    return [];
  };
  sql.release = async () => { calls.push(["release"]); };
  let strictScope = false;
  return {
    strictResolverContractVersion: STRICT_RESOLVER_CONTRACT_VERSION,
    preservedOriginReleaseSha: PRESERVED_ORIGIN_RELEASE_SHA_V1,
    preservedOriginRuntime: PRESERVED_ORIGIN_RUNTIME_V1,
    createScientificCheckpointStoreV1: () => { assert.fail("builder store called"); },
    bootstrapAndQueueHistoricalSimulationOnExecutionServerV2: () => { assert.fail("bootstrap called"); },
    runHistoricalSimulationLaunchConsumerCliV2: () => { assert.fail("consumer called"); },
    verifyHistoricalTerminalLaunchV1: () => { assert.fail("terminal called"); },
    createStrictScientificEvidenceResolverV1(graph) {
      calls.push(["resolver", graph]);
      return { contractVersion: STRICT_RESOLVER_CONTRACT_VERSION, identities };
    },
    async withStrictScientificResolverV1(resolver, work) {
      assert.equal(resolver.contractVersion, STRICT_RESOLVER_CONTRACT_VERSION);
      calls.push(["strict-enter"]);
      strictScope = true;
      try { return await work(); }
      finally { strictScope = false; calls.push(["strict-exit"]); }
    },
    waiaCampaignPostgresDriverOptions() { return { max: 1 }; },
    postgres() {
      calls.push(["pool"]);
      return {
        async end(closeOptions) { calls.push(["close", closeOptions]); },
        async reserve() { calls.push(["reserve"]); return sql; },
      };
    },
    guardSingleConnectionPostgresPool(pool) { calls.push(["guard"]); return pool; },
    bindHistoricalRunnerLoginGuardedPoolV2(pool) { calls.push(["loginGuard"]); return pool; },
    bindPostgresReservedSession(_pool, reserved) { calls.push(["session"]); return reserved; },
    async requireHistoricalSimulationRunnerLoginV2() { calls.push(["login"]); },
    async assumeHistoricalSimulationRunnerRoleV2() { calls.push(["assume"]); },
    async resetHistoricalSimulationRunnerRoleV2() { calls.push(["reset"]); },
    assertHistoricalTechnicalProposalV2() { calls.push(["assert-proposal"]); },
    computeSemanticSha256Hex() { return ratificationDigest; },
    async withHistoricalLaunchCleanupV2(work, cleanup) {
      try { return await work(); }
      finally { for (const close of cleanup) await close(); }
    },
    async finalizeApprovedHistoricalProposalOnExecutionServerV2(_pool, scope) {
      assert.equal(strictScope, true);
      calls.push(["finalize", scope]);
      return { authorityId, manifest: { contentDigestHex: "c".repeat(64) } };
    },
  };
}

test("DEE-1013 exact O/P/R binding, proposal, ratification and strict finalization succeed and stop", async () => {
  const fixture = createOprFixture();
  try {
    assert.equal(
      readHistoricalOprBindingManifestV1(fixture.manifestPath, fixture.digest).digest,
      fixture.digest,
    );
    verifyHistoricalOprReleaseBindingV1(fixture.binding);
    const env = validFinalizationEnvironment(fixture.body);
    assert.equal(validateManifestBoundFinalizationEnvironmentV1(fixture.binding, env), env);
    assert.deepEqual(
      validateManifestBoundFinalizationInvocationV1([
        "finalize-only", "--release-binding", fixture.manifestPath,
        "--binding-digest", fixture.digest, "--proposal-id", proposalId,
        "--proposal-digest", proposalDigest,
      ], ["--conditions=react-server"]),
      {
        manifestPath: fixture.manifestPath, expectedDigest: fixture.digest,
        proposalId, proposalDigest,
      },
    );
    const calls = [];
    const result = await finalizeHistoricalProposalWithVerifiedOprBindingV1(
      { binding: fixture.binding, env, proposalId, proposalDigest },
      syntheticOprApi(fixture.binding, calls),
    );
    assert.equal(result.schemaVersion, HISTORICAL_FINALIZE_OPR_RESULT_SCHEMA_V2);
    assert.equal(result.proposalId, proposalId);
    assert.equal(result.proposalContentDigestHex, proposalDigest);
    assert.equal(result.ratificationId, ratificationId);
    assert.equal(result.ratificationContentDigestHex, ratificationDigest);
    assert.equal(result.bindingDigest, fixture.digest);
    assert.equal(result.evaluatorReleaseSha, fixture.body.namespaces.evaluator.releaseSha);
    assert.notEqual(result.evaluatorReleaseSha, PRESERVED_ORIGIN_RELEASE_SHA_V1);
    assert.equal(result.status, "FINALIZER_RETURNED");
    assert.equal(result.authorityPresent, true);
    assert.equal(result.bootstrapInvokedByThisDriver, false);
    assert.equal(result.consumerInvokedByThisDriver, false);
    assert.equal(result.terminalReceiptInvokedByThisDriver, false);
    assert.equal(result.archiveBarrierEstablished, false);
    assert.equal(result.readinessGranted, false);
    const sqlIndex = calls.findIndex(([name]) => name === "sql");
    const finalizeIndex = calls.findIndex(([name]) => name === "finalize");
    assert.ok(sqlIndex >= 0 && finalizeIndex > sqlIndex);
    assert.equal(calls.some(([name]) => name === "finalize"), true);
    assert.equal(calls.some(([name]) => name === "close"), true);
    assert.equal(JSON.stringify(result).includes("postgres://"), false);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("DEE-1013 refuses wrong binding digest, release/tree, evidence, org/run, and mixed identities", () => {
  const fixture = createOprFixture();
  try {
    assert.throws(
      () => parseHistoricalOprBindingManifestV1(fixture.bytes, "0".repeat(64)),
      /MANIFEST_DIGEST/,
    );
    const wrongTree = clone(fixture.body);
    wrongTree.namespaces.producer.source.gitTreeSha = "c".repeat(40);
    assert.throws(
      () => verifyHistoricalOprReleaseBindingV1(parsedBinding(wrongTree).binding),
      /PRODUCER_TREE/,
    );
    const wrongEvidence = clone(fixture.body);
    wrongEvidence.namespaces.producer.evidence.sealKeyDigest = "e".repeat(64);
    assert.throws(
      () => verifyHistoricalOprReleaseBindingV1(parsedBinding(wrongEvidence).binding),
      /PRODUCER_EVIDENCE_ROOT/,
    );
    verifyHistoricalOprReleaseBindingV1(fixture.binding);
    for (const patch of [
      { WAIA_HISTORICAL_RUN_ID: "wrong-run" },
      { WAIA_HISTORICAL_ORGANIZATION_ID: "33333333-3333-4333-8333-333333333333" },
      { WAIA_RELEASE_SHA: "f".repeat(40) },
      { WAIA_IMAGE_RELEASE_SHA: "f".repeat(40) },
      { WAIA_FHV_CHECKPOINT_ROOT: "/mutable/default" },
    ]) {
      assert.throws(
        () => validateManifestBoundFinalizationEnvironmentV1(fixture.binding, {
          ...validFinalizationEnvironment(fixture.body), ...patch,
        }),
        /HISTORICAL_FINALIZE_ONLY_REFUSED/,
      );
    }
    const mixed = clone(fixture.body);
    mixed.namespaces.producer.releaseSha = mixed.namespaces.evaluator.releaseSha;
    assert.throws(() => parsedBinding(mixed), /COLLAPSED_RELEASES/);
    const originAsR = clone(fixture.body);
    originAsR.namespaces.evaluator.releaseSha = PRESERVED_ORIGIN_RELEASE_SHA_V1;
    originAsR.proposalIdentity.releaseSha = PRESERVED_ORIGIN_RELEASE_SHA_V1;
    assert.throws(() => parsedBinding(originAsR), /COLLAPSED_RELEASES/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("DEE-1013 refuses proposal/ratification mismatch, missing resolver, builder fallback, and current checkout", async () => {
  const fixture = createOprFixture();
  try {
    verifyHistoricalOprReleaseBindingV1(fixture.binding);
    const env = validFinalizationEnvironment(fixture.body);
    const missingCalls = [];
    const missing = syntheticOprApi(fixture.binding, missingCalls);
    delete missing.createStrictScientificEvidenceResolverV1;
    await assert.rejects(
      finalizeHistoricalProposalWithVerifiedOprBindingV1(
        { binding: fixture.binding, env, proposalId, proposalDigest }, missing,
      ),
      /FROZEN_API_createStrictScientificEvidenceResolverV1/,
    );
    assert.equal(missingCalls.some(([name]) => name === "finalize"), false);

    const wrongProposal = syntheticOprApi(fixture.binding, [], {
      proposalRows: [{
        id: proposalId, proposal_json: {
          organizationId, runId: "other-run",
          releaseSha: fixture.body.namespaces.evaluator.releaseSha,
          contentDigestHex: proposalDigest,
        }, content_digest_hex: proposalDigest,
      }],
    });
    await assert.rejects(
      finalizeHistoricalProposalWithVerifiedOprBindingV1(
        { binding: fixture.binding, env, proposalId, proposalDigest }, wrongProposal,
      ),
      /PROPOSAL_SCOPE/,
    );

    const missingApproval = syntheticOprApi(fixture.binding, [], { ratificationRows: [] });
    await assert.rejects(
      finalizeHistoricalProposalWithVerifiedOprBindingV1(
        { binding: fixture.binding, env, proposalId, proposalDigest }, missingApproval,
      ),
      /RATIFICATION_MISSING/,
    );

    const wrongAction = syntheticOprApi(fixture.binding, [], {
      ratificationRows: [{
        id: ratificationId, operator_user_id: organizationId, ratification_json: {
          schemaVersion: "waia.trader.historical_proposal_ratification.v2",
          organizationId, runId: fixture.body.proposalIdentity.runId,
          releaseSha: fixture.body.namespaces.evaluator.releaseSha,
          proposalId, proposalContentDigestHex: proposalDigest,
          operatorUserId: organizationId, humanDecision: "SYNTHETIC_RATIFICATION",
          contentDigestHex: ratificationDigest,
        }, content_digest_hex: ratificationDigest,
      }],
    });
    await assert.rejects(
      finalizeHistoricalProposalWithVerifiedOprBindingV1(
        { binding: fixture.binding, env, proposalId, proposalDigest }, wrongAction,
      ),
      /RATIFICATION_ACTION/,
    );

    await assert.rejects(loadManifestBoundFinalizerApiV1({}), /UNVERIFIED_BINDING/);
    assert.throws(
      () => validateManifestBoundFinalizationInvocationV1([
        "finalize-only", fixture.root, "--release-binding", fixture.manifestPath,
      ], ["--conditions=react-server"]),
      /EXPLICIT_INVOCATION/,
    );
    assert.throws(
      () => validateManifestBoundFinalizationInvocationV1([
        "finalize-only", "--release-binding", fixture.manifestPath,
        "--binding-digest", fixture.digest, "--proposal-id", proposalId,
        "--proposal-digest", proposalDigest, "--ratification-id", ratificationId,
      ], ["--conditions=react-server"]),
      /EXPLICIT_INVOCATION/,
    );

    const original = fixture.body.namespaces.producer.releaseSha;
    writeFileSync(join(fixture.producerRoot, "producer.txt"), "different checkout");
    git(fixture.producerRoot, ["add", "producer.txt"]);
    git(fixture.producerRoot, [
      "-c", "user.name=WAIA Test", "-c", "user.email=test@waia.invalid",
      "commit", "-q", "-m", "different-checkout",
    ], {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-03T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-03T00:00:00Z",
      },
    });
    try {
      assert.throws(
        () => verifyHistoricalOprReleaseBindingV1(parsedBinding(fixture.body).binding),
        /PRODUCER_CHECKOUT/,
      );
    } finally {
      git(fixture.producerRoot, ["checkout", "-q", "--detach", original]);
    }
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("DEE-1013 frozen R loader selects finalizer APIs only and never uses 90de as executable R", () => {
  const source = readFileSync(resolve("scripts/ops/historical-finalize-only-v1.mjs"), "utf8");
  const loader = source.slice(
    source.indexOf("export async function loadManifestBoundFinalizerApiV1"),
    source.indexOf("export async function assertPersistedHistoricalApprovalV1"),
  );
  const positive = source.slice(
    source.indexOf("export async function runOperatorMain()"),
    source.indexOf("const root = validateInvocation"),
  );
  assert.match(loader, /binding\.namespaces\.evaluator\.source\.root/);
  assert.doesNotMatch(loader, /SCIENTIFIC_RELEASE|90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/);
  assert.doesNotMatch(loader, /git rev-parse HEAD|origin\/main|process\.cwd/);
  assert.doesNotMatch(
    loader,
    /scientific-checkpoint-store-v1|execution-server-bootstrap|launch-consumer-cli|historical-terminal-receipts/,
  );
  assert.doesNotMatch(positive, /GENERIC_OPERATOR_LAUNCH_NOT_THIS_ISSUE/);
  assert.match(positive, /loadManifestBoundFinalizerApiV1/);
  assert.match(source, /REQUIRED_HUMAN_RATIFICATION_ACTION/);
  assert.equal(
    /runApprovedHistoricalLaunchCliV2\(|bootstrapAndQueueHistoricalSimulationOnExecutionServerV2\(|executeQueuedHistoricalSimulationLaunchV2\(/.test(source),
    false,
  );
});

test("DEE-1013 frozen R checkout import-only smoke loads evaluator APIs, not 90de", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-dee1013-import-")));
  try {
    const originRoot = createOriginRepository(root);
    const producerRoot = createSyntheticRepository(root, "producer-source", { "producer.txt": "producer" });
    const evaluatorRoot = join(root, "actual-evaluator-source");
    execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", process.cwd(), evaluatorRoot]);
    const evaluatorRelease = git(process.cwd(), ["rev-parse", "HEAD"]);
    git(evaluatorRoot, ["checkout", "-q", "--detach", evaluatorRelease]);
    symlinkSync(resolve("node_modules"), join(evaluatorRoot, "node_modules"));
    const originEvidence = createEvidenceRoot(root, "origin", 1);
    const producerEvidence = createEvidenceRoot(root, "producer", 2);
    const evaluatorEvidence = createEvidenceRoot(root, "actual-evaluator", 4);
    const body = {
      strictResolverContractVersion: STRICT_RESOLVER_CONTRACT_VERSION,
      proposalIdentity: { organizationId, runId: "historical-finalize-import", releaseSha: evaluatorRelease },
      namespaces: {
        origin: {
          releaseSha: PRESERVED_ORIGIN_RELEASE_SHA_V1, runtime: PRESERVED_ORIGIN_RUNTIME_V1,
          source: sourceBinding(originRoot, ["package.json"]), evidence: originEvidence,
        },
        producer: {
          releaseSha: git(producerRoot, ["rev-parse", "HEAD"]),
          runtime: { node: "v22.23.2", os: "linux", arch: "x64" },
          source: sourceBinding(producerRoot, ["producer.txt"]), evidence: producerEvidence,
        },
        evaluator: {
          releaseSha: evaluatorRelease,
          runtime: { node: process.version, os: process.platform, arch: process.arch },
          source: sourceBinding(realpathSync(evaluatorRoot), evaluatorSourcePaths),
          evidence: evaluatorEvidence,
        },
      },
    };
    const parsed = parsedBinding(body);
    const manifestPath = join(root, "binding.json");
    writeFileSync(manifestPath, parsed.bytes, { mode: 0o600 });
    chmodSync(manifestPath, 0o600);
    const operatorUrl = pathToFileURL(resolve("scripts/ops/historical-finalize-only-v1.mjs")).href;
    const code = `
      import assert from "node:assert/strict";
      import {
        readHistoricalOprBindingManifestV1,
        verifyHistoricalOprReleaseBindingV1,
      } from ${JSON.stringify(pathToFileURL(resolve("scripts/ops/historical-release-binding-v1.mjs")).href)};
      import { loadManifestBoundFinalizerApiV1 } from ${JSON.stringify(operatorUrl)};
      const binding = readHistoricalOprBindingManifestV1(
        ${JSON.stringify(realpathSync(manifestPath))},
        ${JSON.stringify(parsed.digest)},
      );
      verifyHistoricalOprReleaseBindingV1(binding);
      assert.notEqual(binding.namespaces.evaluator.releaseSha, ${JSON.stringify(PRESERVED_ORIGIN_RELEASE_SHA_V1)});
      const loaded = await loadManifestBoundFinalizerApiV1(binding);
      try {
        for (const name of [
          "createStrictScientificEvidenceResolverV1",
          "withStrictScientificResolverV1",
          "finalizeApprovedHistoricalProposalOnExecutionServerV2",
          "assertHistoricalTechnicalProposalV2",
        ]) assert.equal(typeof loaded.api[name], "function", name);
        for (const forbidden of [
          "createScientificCheckpointStoreV1",
          "bootstrapAndQueueHistoricalSimulationOnExecutionServerV2",
          "runHistoricalSimulationLaunchConsumerCliV2",
        ]) assert.equal(loaded.api[forbidden], undefined, forbidden);
        process.stdout.write("FROZEN_R_FINALIZER_API_PASS\\n");
      } finally { await loaded.unregister(); }
    `;
    const result = spawnSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", code], {
      encoding: "utf8", timeout: 30_000,
      env: { PATH: process.env.PATH, NODE_ENV: "production", WAIA_TRADER_CLI: "1" },
    });
    assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
    assert.equal(result.stdout, "FROZEN_R_FINALIZER_API_PASS\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
