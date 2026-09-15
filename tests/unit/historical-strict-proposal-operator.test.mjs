import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  PRESERVED_ORIGIN_RELEASE_SHA_V1,
  PRESERVED_ORIGIN_RUNTIME_V1,
  STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1,
  fingerprintHistoricalCoveredSourceV1,
  parseHistoricalOprBindingManifestV1,
  readHistoricalOprBindingManifestV1,
  serializeHistoricalOprBindingManifestV1,
  verifyHistoricalOprReleaseBindingV1,
} from "../../scripts/ops/historical-release-binding-v1.mjs";
import {
  loadFrozenHistoricalProposalApiV1,
  prepareHistoricalProposalWithStrictResolverV1,
  validateHistoricalProposalBindingEnvironmentV1,
  validateHistoricalProposalInvocationV1,
} from "../../scripts/ops/historical-prepare-proposal-v1.mjs";

const evaluatorSourcePaths = [
  "db",
  "lib",
  "package.json",
  "scripts/trader/scientific-checkpoint-key-v1.ts",
  "scripts/trader/scientific-evidence-resolver-v1.ts",
  "tsconfig.json",
];
const organizationId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
let fixture;

function git(root, args, options = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
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
  git(
    root,
    ["-c", "user.name=WAIA Test", "-c", "user.email=test@waia.invalid", "commit", "-q", "-m", name],
    {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE:
          name === "producer-source" ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z",
        GIT_COMMITTER_DATE:
          name === "producer-source" ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z",
      },
    },
  );
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
  return {
    root: realpathSync(root),
    sealKeyDigest: createHash("sha256").update(key).digest("hex"),
  };
}

function sourceBinding(root, paths) {
  const covered = fingerprintHistoricalCoveredSourceV1(root, paths);
  return {
    root,
    gitTreeSha: git(root, ["rev-parse", "HEAD^{tree}"]),
    coveredSourceDigest: covered.digest,
    coveredSourceFileCount: covered.fileCount,
    coveredSourcePaths: paths,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parsedBinding(body) {
  const bytes = serializeHistoricalOprBindingManifestV1(body);
  const digest = JSON.parse(bytes).digest;
  return {
    binding: parseHistoricalOprBindingManifestV1(bytes, digest),
    bytes,
    digest,
  };
}

function createFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-dee1011-")));
  const originRoot = createOriginRepository(root);
  const producerRoot = createSyntheticRepository(root, "producer-source", {
    "producer.txt": "producer",
  });
  const evaluatorRoot = createSyntheticRepository(root, "evaluator-source", {
    db: "db source",
    lib: "lib source",
    "package.json": "{}\n",
    "scripts/trader/scientific-checkpoint-key-v1.ts": "export const key = 1;\n",
    "scripts/trader/scientific-evidence-resolver-v1.ts": "export const resolver = 1;\n",
    "tsconfig.json": "{}\n",
  });
  const originEvidence = createEvidenceRoot(root, "origin", 1);
  const producerEvidence = createEvidenceRoot(root, "producer", 2);
  const evaluatorEvidence = createEvidenceRoot(root, "evaluator", 3);
  const producerRelease = git(producerRoot, ["rev-parse", "HEAD"]);
  const evaluatorRelease = git(evaluatorRoot, ["rev-parse", "HEAD"]);
  const evaluatorRuntime = {
    node: process.version,
    os: process.platform,
    arch: process.arch,
  };
  const body = {
    strictResolverContractVersion: STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1,
    proposalIdentity: {
      organizationId,
      runId: "historical-proposal-1",
      releaseSha: evaluatorRelease,
    },
    namespaces: {
      origin: {
        releaseSha: PRESERVED_ORIGIN_RELEASE_SHA_V1,
        runtime: PRESERVED_ORIGIN_RUNTIME_V1,
        source: sourceBinding(originRoot, ["package.json"]),
        evidence: originEvidence,
      },
      producer: {
        releaseSha: producerRelease,
        runtime: { node: "v22.23.2", os: "linux", arch: "x64" },
        source: sourceBinding(producerRoot, ["producer.txt"]),
        evidence: producerEvidence,
      },
      evaluator: {
        releaseSha: evaluatorRelease,
        runtime: evaluatorRuntime,
        source: sourceBinding(evaluatorRoot, evaluatorSourcePaths),
        evidence: evaluatorEvidence,
      },
    },
  };
  const parsed = parsedBinding(body);
  const manifestPath = join(root, "binding.json");
  writeFileSync(manifestPath, parsed.bytes, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  return {
    root,
    body,
    ...parsed,
    manifestPath: realpathSync(manifestPath),
    producerRoot,
  };
}

function validEnvironment(body = fixture.body) {
  return {
    WAIA_TRADER_CLI: "1",
    WAIA_EXECUTION_HOST_MODE: "idle",
    WAIA_RELEASE_SHA: body.namespaces.evaluator.releaseSha,
    WAIA_IMAGE_RELEASE_SHA: body.namespaces.evaluator.releaseSha,
    WAIA_HISTORICAL_ORGANIZATION_ID: body.proposalIdentity.organizationId,
    WAIA_HISTORICAL_RUN_ID: body.proposalIdentity.runId,
  };
}

before(() => {
  fixture = createFixture();
});

after(() => {
  rmSync(fixture.root, { recursive: true, force: true });
});

test("exact canonical O/P/R release, source, evidence, and runtime binding passes", () => {
  assert.equal(
    readHistoricalOprBindingManifestV1(fixture.manifestPath, fixture.digest).digest,
    fixture.digest,
  );
  assert.equal(verifyHistoricalOprReleaseBindingV1(fixture.binding), fixture.binding);
  const env = validEnvironment();
  assert.equal(validateHistoricalProposalBindingEnvironmentV1(fixture.binding, env), env);
});

test("missing or wrong O/P/R and mixed release identities refuse", () => {
  for (const namespace of ["origin", "producer", "evaluator"]) {
    const body = clone(fixture.body);
    delete body.namespaces[namespace];
    assert.throws(() => parsedBinding(body), /NAMESPACES/);
  }
  const wrongOrigin = clone(fixture.body);
  wrongOrigin.namespaces.origin.releaseSha = "a".repeat(40);
  assert.throws(() => parsedBinding(wrongOrigin), /ORIGIN_RELEASE/);
  for (const namespace of ["producer", "evaluator"]) {
    const body = clone(fixture.body);
    body.namespaces[namespace].releaseSha = "b".repeat(40);
    if (namespace === "evaluator") body.proposalIdentity.releaseSha = "b".repeat(40);
    const { binding } = parsedBinding(body);
    assert.throws(() => verifyHistoricalOprReleaseBindingV1(binding), /_RELEASE/);
  }
  const mixed = clone(fixture.body);
  mixed.namespaces.producer.releaseSha = mixed.namespaces.evaluator.releaseSha;
  assert.throws(() => parsedBinding(mixed), /COLLAPSED_RELEASES/);
});

test("wrong source tree, covered source, and evidence roots refuse before composition", () => {
  const wrongTree = clone(fixture.body);
  wrongTree.namespaces.producer.source.gitTreeSha = "c".repeat(40);
  assert.throws(
    () => verifyHistoricalOprReleaseBindingV1(parsedBinding(wrongTree).binding),
    /PRODUCER_TREE/,
  );
  const wrongSource = clone(fixture.body);
  wrongSource.namespaces.producer.source.coveredSourceDigest = "d".repeat(64);
  assert.throws(
    () => verifyHistoricalOprReleaseBindingV1(parsedBinding(wrongSource).binding),
    /PRODUCER_SOURCE_DIGEST/,
  );
  const wrongEvidence = clone(fixture.body);
  wrongEvidence.namespaces.producer.evidence.sealKeyDigest = "e".repeat(64);
  assert.throws(
    () => verifyHistoricalOprReleaseBindingV1(parsedBinding(wrongEvidence).binding),
    /PRODUCER_EVIDENCE_ROOT/,
  );
});

test("runtime mismatch and proposal run or organization mismatch refuse", () => {
  const wrongRuntime = clone(fixture.body);
  wrongRuntime.namespaces.evaluator.runtime.node =
    process.version === "v99.0.0" ? "v98.0.0" : "v99.0.0";
  assert.throws(
    () => verifyHistoricalOprReleaseBindingV1(parsedBinding(wrongRuntime).binding),
    /EVALUATOR_RUNTIME/,
  );
  verifyHistoricalOprReleaseBindingV1(fixture.binding);
  for (const patch of [
    { WAIA_HISTORICAL_RUN_ID: "wrong-run" },
    { WAIA_HISTORICAL_ORGANIZATION_ID: "33333333-3333-4333-8333-333333333333" },
    { WAIA_RELEASE_SHA: "f".repeat(40) },
    { WAIA_IMAGE_RELEASE_SHA: "f".repeat(40) },
  ]) {
    assert.throws(
      () =>
        validateHistoricalProposalBindingEnvironmentV1(fixture.binding, {
          ...validEnvironment(),
          ...patch,
        }),
      /HISTORICAL_PREPARE_PROPOSAL_REFUSED/,
    );
  }
});

test("manifest requires an external digest and canonical unambiguous bytes", () => {
  assert.throws(
    () => parseHistoricalOprBindingManifestV1(fixture.bytes, "0".repeat(64)),
    /MANIFEST_DIGEST/,
  );
  const pretty = `${JSON.stringify(JSON.parse(fixture.bytes), null, 2)}\n`;
  assert.throws(
    () => parseHistoricalOprBindingManifestV1(pretty, fixture.digest),
    /AMBIGUOUS_MANIFEST/,
  );
  const unknown = clone(fixture.body);
  unknown.namespaces.origin.alternativeRelease = fixture.body.namespaces.producer.releaseSha;
  assert.throws(() => parsedBinding(unknown), /ORIGIN_FIELDS/);
});

test("explicit invocation cannot use implicit paths, reordered flags, or preload arguments", () => {
  assert.deepEqual(
    validateHistoricalProposalInvocationV1(
      [
        "prepare-proposal",
        "--release-binding",
        fixture.manifestPath,
        "--binding-digest",
        fixture.digest,
      ],
      ["--conditions=react-server"],
    ),
    { manifestPath: fixture.manifestPath, expectedDigest: fixture.digest },
  );
  for (const args of [
    [],
    ["prepare-proposal", "--release-binding", "relative.json", "--binding-digest", fixture.digest],
    [
      "prepare-proposal",
      "--binding-digest",
      fixture.digest,
      "--release-binding",
      fixture.manifestPath,
    ],
  ]) {
    assert.throws(
      () => validateHistoricalProposalInvocationV1(args, ["--conditions=react-server"]),
      /EXPLICIT_INVOCATION/,
    );
  }
  assert.throws(
    () =>
      validateHistoricalProposalInvocationV1(
        [
          "prepare-proposal",
          "--release-binding",
          fixture.manifestPath,
          "--binding-digest",
          fixture.digest,
        ],
        ["--conditions=react-server", "--import=evil"],
      ),
    /NODE_ARGUMENTS/,
  );
});

function syntheticApi(calls) {
  let strictScope = false;
  const pools = [];
  const identities = Object.fromEntries(
    Object.entries(fixture.binding.namespaces).map(([name, namespace]) => [
      name,
      { releaseSha: namespace.releaseSha, runtime: namespace.runtime },
    ]),
  );
  return {
    strictResolverContractVersion: STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1,
    preservedOriginReleaseSha: PRESERVED_ORIGIN_RELEASE_SHA_V1,
    preservedOriginRuntime: PRESERVED_ORIGIN_RUNTIME_V1,
    createStrictScientificEvidenceResolverV1(graph) {
      calls.push(["resolver", graph]);
      return {
        contractVersion: STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1,
        identities,
      };
    },
    async withStrictScientificResolverV1(resolver, work) {
      assert.equal(resolver.contractVersion, STRICT_SCIENTIFIC_RESOLVER_CONTRACT_V1);
      calls.push(["strict-enter"]);
      strictScope = true;
      try {
        return await work();
      } finally {
        strictScope = false;
        calls.push(["strict-exit"]);
      }
    },
    async runHistoricalTechnicalProposalCliV2(env, prepare) {
      assert.equal(strictScope, true);
      calls.push(["cli"]);
      return prepare("postgres://synthetic", {
        preflight: {
          organizationId: env.WAIA_HISTORICAL_ORGANIZATION_ID,
          runId: env.WAIA_HISTORICAL_RUN_ID,
          releaseSha: env.WAIA_RELEASE_SHA,
        },
        launchPlan: {},
      });
    },
    waiaCampaignPostgresDriverOptions() {
      return { max: 1 };
    },
    postgres(_databaseUrl, options) {
      const pool = {
        options,
        async end(closeOptions) {
          calls.push(["close", closeOptions]);
        },
      };
      pools.push(pool);
      calls.push(["pool", options]);
      return pool;
    },
    guardSingleConnectionPostgresPool(pool) {
      calls.push(["guard"]);
      return pool;
    },
    async withHistoricalLaunchCleanupV2(work, cleanup) {
      try {
        return await work();
      } finally {
        for (const close of cleanup) await close();
      }
    },
    async prepareHistoricalTechnicalProposalOnExecutionServerV2(
      _pool,
      input,
      observer,
      eventsPool,
    ) {
      assert.equal(strictScope, true);
      assert.notEqual(_pool, eventsPool);
      assert.equal(typeof observer.onProgress, "function");
      calls.push(["prepare"]);
      return {
        id: proposalId,
        proposal: {
          organizationId: input.preflight.organizationId,
          runId: input.preflight.runId,
          releaseSha: input.preflight.releaseSha,
          contentDigestHex: "a".repeat(64),
        },
      };
    },
    finalizeApprovedHistoricalProposalOnExecutionServerV2() {
      assert.fail("finalization called");
    },
    bootstrapAndQueueHistoricalSimulationOnExecutionServerV2() {
      assert.fail("bootstrap called");
    },
    createScientificCheckpointStoreV1() {
      assert.fail("builder store called");
    },
  };
}

test("strict resolver is constructed before existing proposal preparation and no later boundary runs", async () => {
  verifyHistoricalOprReleaseBindingV1(fixture.binding);
  const calls = [];
  const api = syntheticApi(calls);
  const result = await prepareHistoricalProposalWithStrictResolverV1(
    { binding: fixture.binding, env: validEnvironment() },
    api,
    undefined,
    { onProgress() {} },
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "resolver",
      "strict-enter",
      "cli",
      "pool",
      "pool",
      "guard",
      "guard",
      "prepare",
      "close",
      "close",
      "strict-exit",
    ],
  );
  assert.equal(result.proposalId, proposalId);
  assert.equal(result.bindingDigest, fixture.digest);
  assert.equal(result.authorityGranted, false);
  assert.equal(result.finalizationInvoked, false);
  assert.equal(JSON.stringify(result).includes("postgres://"), false);
});

test("resolver absence and builder fallback attempts refuse before pools or proposal mutation", async () => {
  verifyHistoricalOprReleaseBindingV1(fixture.binding);
  const missingCalls = [];
  const missing = syntheticApi(missingCalls);
  delete missing.createStrictScientificEvidenceResolverV1;
  await assert.rejects(
    prepareHistoricalProposalWithStrictResolverV1(
      { binding: fixture.binding, env: validEnvironment() },
      missing,
    ),
    /FROZEN_API_createStrictScientificEvidenceResolverV1/,
  );
  assert.deepEqual(missingCalls, []);

  const fallbackCalls = [];
  await assert.rejects(
    prepareHistoricalProposalWithStrictResolverV1(
      {
        binding: fixture.binding,
        env: { ...validEnvironment(), WAIA_FHV_CHECKPOINT_ROOT: "/mutable/default" },
      },
      syntheticApi(fallbackCalls),
    ),
    /FORBIDDEN_ENVIRONMENT/,
  );
  assert.deepEqual(fallbackCalls, []);
});

test("frozen loader accepts only a verified R binding and selects no finalizer or builder API", async () => {
  await assert.rejects(loadFrozenHistoricalProposalApiV1({}), /UNVERIFIED_BINDING/);
  const source = readFileSync(resolve("scripts/ops/historical-prepare-proposal-v1.mjs"), "utf8");
  const loader = source.slice(
    source.indexOf("export async function loadFrozenHistoricalProposalApiV1"),
    source.indexOf("export async function prepareHistoricalProposalWithStrictResolverV1"),
  );
  assert.match(loader, /binding\.namespaces\.evaluator\.source\.root/);
  assert.doesNotMatch(loader, /git rev-parse HEAD|origin\/main|process\.cwd/);
  assert.doesNotMatch(
    loader,
    /finalizeApprovedHistoricalProposal|bootstrapAndQueue|createScientificCheckpointStore/,
  );
});

test("frozen loader imports the allowlisted proposal API from an exact verified R checkout", () => {
  const evaluatorRoot = join(fixture.root, "actual-evaluator-source");
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", process.cwd(), evaluatorRoot]);
  const evaluatorRelease = git(process.cwd(), ["rev-parse", "HEAD"]);
  git(evaluatorRoot, ["checkout", "-q", "--detach", evaluatorRelease]);
  symlinkSync(resolve("node_modules"), join(evaluatorRoot, "node_modules"));
  const evaluatorEvidence = createEvidenceRoot(fixture.root, "actual-evaluator", 4);
  const body = clone(fixture.body);
  body.proposalIdentity.releaseSha = evaluatorRelease;
  body.namespaces.evaluator = {
    releaseSha: evaluatorRelease,
    runtime: { node: process.version, os: process.platform, arch: process.arch },
    source: sourceBinding(realpathSync(evaluatorRoot), evaluatorSourcePaths),
    evidence: evaluatorEvidence,
  };
  const parsed = parsedBinding(body);
  const manifestPath = join(fixture.root, "actual-binding.json");
  writeFileSync(manifestPath, parsed.bytes, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  const operatorUrl = pathToFileURL(resolve("scripts/ops/historical-prepare-proposal-v1.mjs")).href;
  const code = `
    import assert from "node:assert/strict";
    import {
      readHistoricalOprBindingManifestV1,
      verifyHistoricalOprReleaseBindingV1,
    } from ${JSON.stringify(
      pathToFileURL(resolve("scripts/ops/historical-release-binding-v1.mjs")).href,
    )};
    import { loadFrozenHistoricalProposalApiV1 } from ${JSON.stringify(operatorUrl)};
    const binding = readHistoricalOprBindingManifestV1(
      ${JSON.stringify(realpathSync(manifestPath))},
      ${JSON.stringify(parsed.digest)},
    );
    verifyHistoricalOprReleaseBindingV1(binding);
    const loaded = await loadFrozenHistoricalProposalApiV1(binding);
    try {
      for (const name of [
        "runHistoricalTechnicalProposalCliV2",
        "prepareHistoricalTechnicalProposalOnExecutionServerV2",
        "createStrictScientificEvidenceResolverV1",
        "withStrictScientificResolverV1",
      ]) assert.equal(typeof loaded.api[name], "function", name);
      for (const forbidden of [
        "finalizeApprovedHistoricalProposalOnExecutionServerV2",
        "createScientificCheckpointStoreV1",
        "bootstrapAndQueueHistoricalSimulationOnExecutionServerV2",
      ]) assert.equal(loaded.api[forbidden], undefined, forbidden);
      process.stdout.write("FROZEN_R_API_PASS\\n");
    } finally {
      await loaded.unregister();
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--input-type=module", "-e", code],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { PATH: process.env.PATH, NODE_ENV: "production", WAIA_TRADER_CLI: "1" },
    },
  );
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.equal(result.stdout, "FROZEN_R_API_PASS\n");
});

test("current checkout substitution is refused even when the frozen commit still exists", () => {
  const original = fixture.body.namespaces.producer.releaseSha;
  writeFileSync(join(fixture.producerRoot, "producer.txt"), "different checkout");
  git(fixture.producerRoot, ["add", "producer.txt"]);
  git(
    fixture.producerRoot,
    [
      "-c",
      "user.name=WAIA Test",
      "-c",
      "user.email=test@waia.invalid",
      "commit",
      "-q",
      "-m",
      "different-checkout",
    ],
    {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-03T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-03T00:00:00Z",
      },
    },
  );
  try {
    assert.throws(
      () => verifyHistoricalOprReleaseBindingV1(parsedBinding(fixture.body).binding),
      /PRODUCER_CHECKOUT/,
    );
  } finally {
    git(fixture.producerRoot, ["checkout", "-q", "--detach", original]);
  }
});
