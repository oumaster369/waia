/**
 * Separately mounted strict historical proposal-preparation sidecar.
 *
 * Usage:
 * node --conditions=react-server historical-prepare-proposal-v1.mjs \
 *   prepare-proposal --release-binding /absolute/binding.json \
 *   --binding-digest <sha256>
 */
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertVerifiedHistoricalOprReleaseBindingV1,
  readHistoricalOprBindingManifestV1,
  verifyHistoricalOprReleaseBindingV1,
} from "./historical-release-binding-v1.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refuse(code) {
  throw new Error(`HISTORICAL_PREPARE_PROPOSAL_REFUSED:${code}`);
}

function active(signal) {
  if (signal?.aborted) refuse("CANCELLED");
}

function requiredFunction(api, name) {
  if (typeof api?.[name] !== "function") refuse(`FROZEN_API_${name}`);
  return api[name];
}

function sameRuntime(left, right) {
  return left?.node === right.node && left?.os === right.os && left?.arch === right.arch;
}

function sameIdentity(left, right) {
  return left?.releaseSha === right.releaseSha && sameRuntime(left.runtime, right.runtime);
}

function historicalChildHeapOptions(value) {
  if (value === undefined || value.trim() === "") return;
  const match = /^--max[-_]old[-_]space[-_]size(?:=| +)([1-9][0-9]*)$/.exec(value.trim());
  if (!match) {
    refuse("NODE_OPTIONS");
  }
  const megabytes = Number(match[1]);
  if (!Number.isSafeInteger(megabytes) || megabytes < 128 || megabytes > 32768) {
    refuse("NODE_OPTIONS");
  }
}

export function validateHistoricalProposalBindingEnvironmentV1(binding, env) {
  assertVerifiedHistoricalOprReleaseBindingV1(binding);
  const proposal = binding.proposalIdentity;
  const evaluatorRelease = binding.namespaces.evaluator.releaseSha;
  if (
    env.WAIA_TRADER_CLI !== "1" ||
    env.WAIA_EXECUTION_HOST_MODE !== "idle" ||
    env.WAIA_RELEASE_SHA !== evaluatorRelease ||
    env.WAIA_IMAGE_RELEASE_SHA !== evaluatorRelease
  ) {
    refuse("RELEASE_RUNTIME_ENVIRONMENT");
  }
  if (
    env.WAIA_HISTORICAL_ORGANIZATION_ID !== proposal.organizationId ||
    env.WAIA_HISTORICAL_RUN_ID !== proposal.runId ||
    proposal.releaseSha !== evaluatorRelease
  ) {
    refuse("PROPOSAL_IDENTITY");
  }
  historicalChildHeapOptions(env.NODE_OPTIONS);
  const forbidden = Object.keys(env).find(
    (key) =>
      env[key]?.trim() &&
      (/^(?:WAIA|FHV)_.*(?:BUILDER|FALLBACK)/.test(key) ||
        key === "WAIA_FHV_CHECKPOINT_ROOT" ||
        /^WAIA_(?:O|P|R)_(?:RELEASE|SOURCE|TREE|EVIDENCE|RUNTIME)/.test(key) ||
        /^WAIA_.*(?:OPERATOR|RATIFICATION|APPROVAL|AUTHORITY|MANIFEST)/.test(key)),
  );
  if (forbidden) refuse("FORBIDDEN_ENVIRONMENT");
  return env;
}

export function validateHistoricalProposalInvocationV1(args, execArgv) {
  if (
    args.length !== 5 ||
    args[0] !== "prepare-proposal" ||
    args[1] !== "--release-binding" ||
    args[3] !== "--binding-digest" ||
    !isAbsolute(args[2]) ||
    !SHA256.test(args[4])
  ) {
    refuse("EXPLICIT_INVOCATION");
  }
  if (execArgv.length !== 1 || execArgv[0] !== "--conditions=react-server") {
    refuse("NODE_ARGUMENTS");
  }
  return Object.freeze({ manifestPath: args[2], expectedDigest: args[4] });
}

function combinedExports(imported) {
  return {
    ...(typeof imported.default === "object" ? imported.default : {}),
    ...imported,
  };
}

/**
 * Application and dependency imports begin only after the binding verifier has
 * checked O/P/R. Only the proposal API subset is returned; finalization,
 * bootstrap, launch, stores, and builders are not exposed.
 */
export async function loadFrozenHistoricalProposalApiV1(binding) {
  assertVerifiedHistoricalOprReleaseBindingV1(binding);
  const root = binding.namespaces.evaluator.source.root;
  const sourceImport = (path) => import(pathToFileURL(join(root, path)).href);
  const require = createRequire(pathToFileURL(join(root, "package.json")));
  const { register: registerCjs } = await import(
    pathToFileURL(require.resolve("tsx/cjs/api")).href
  );
  const { register } = await import(pathToFileURL(require.resolve("tsx/esm/api")).href);
  const unregisterCjs = registerCjs();
  let unregisterEsm;
  const unregister = async () => {
    try {
      await unregisterEsm?.();
    } finally {
      unregisterCjs();
    }
  };
  try {
    unregisterEsm = register({ tsconfig: join(root, "tsconfig.json") });
    const modules = [];
    for (const path of [
      "db/postgres-client.ts",
      "db/postgres-reserved-close-guard.ts",
      "lib/trader/historical-simulation-v2/launch-cleanup-v2.ts",
      "lib/trader/historical-simulation-v2/launch-error-format-v2.ts",
      "lib/trader/historical-simulation-v2/ratification-execution-cli-v2.ts",
      "lib/trader/historical-simulation-v2/ratification-split-v2.ts",
      "lib/trader/historical-simulation-v2/scientific-evidence-resolver-v1.ts",
      "scripts/trader/scientific-evidence-resolver-v1.ts",
    ]) {
      modules.push(combinedExports(await sourceImport(path)));
    }
    const [
      postgresClient,
      closeGuard,
      cleanup,
      errorFormat,
      cli,
      split,
      resolverContext,
      resolverImplementation,
    ] = modules;
    const postgres = (await import(pathToFileURL(require.resolve("postgres")).href)).default;
    const api = Object.freeze({
      postgres,
      waiaCampaignPostgresDriverOptions: postgresClient.waiaCampaignPostgresDriverOptions,
      guardSingleConnectionPostgresPool: closeGuard.guardSingleConnectionPostgresPool,
      withHistoricalLaunchCleanupV2: cleanup.withHistoricalLaunchCleanupV2,
      formatHistoricalLaunchErrorV2: errorFormat.formatHistoricalLaunchErrorV2,
      runHistoricalTechnicalProposalCliV2: cli.runHistoricalTechnicalProposalCliV2,
      prepareHistoricalTechnicalProposalOnExecutionServerV2:
        split.prepareHistoricalTechnicalProposalOnExecutionServerV2,
      createStrictScientificEvidenceResolverV1:
        resolverImplementation.createStrictScientificEvidenceResolverV1,
      withStrictScientificResolverV1: resolverContext.withStrictScientificResolverV1,
      strictResolverContractVersion:
        resolverContext.STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1,
      preservedOriginReleaseSha: resolverContext.PRESERVED_ORIGIN_RELEASE_SHA_V1,
      preservedOriginRuntime: resolverContext.PRESERVED_ORIGIN_RUNTIME_V1,
    });
    for (const name of [
      "postgres",
      "waiaCampaignPostgresDriverOptions",
      "guardSingleConnectionPostgresPool",
      "withHistoricalLaunchCleanupV2",
      "formatHistoricalLaunchErrorV2",
      "runHistoricalTechnicalProposalCliV2",
      "prepareHistoricalTechnicalProposalOnExecutionServerV2",
      "createStrictScientificEvidenceResolverV1",
      "withStrictScientificResolverV1",
    ]) {
      requiredFunction(api, name);
    }
    if (
      api.strictResolverContractVersion !== binding.strictResolverContractVersion ||
      api.preservedOriginReleaseSha !== binding.namespaces.origin.releaseSha ||
      !sameRuntime(api.preservedOriginRuntime, binding.namespaces.origin.runtime)
    ) {
      refuse("FROZEN_API_IDENTITY");
    }
    return Object.freeze({ api, unregister });
  } catch (error) {
    await unregister();
    throw error;
  }
}

export async function prepareHistoricalProposalWithStrictResolverV1(
  config,
  api,
  signal,
  diagnostics = {},
) {
  const binding = assertVerifiedHistoricalOprReleaseBindingV1(config.binding);
  const env = validateHistoricalProposalBindingEnvironmentV1(binding, config.env);
  active(signal);
  for (const name of [
    "postgres",
    "waiaCampaignPostgresDriverOptions",
    "guardSingleConnectionPostgresPool",
    "withHistoricalLaunchCleanupV2",
    "runHistoricalTechnicalProposalCliV2",
    "prepareHistoricalTechnicalProposalOnExecutionServerV2",
    "createStrictScientificEvidenceResolverV1",
    "withStrictScientificResolverV1",
  ]) {
    requiredFunction(api, name);
  }
  if (
    api.strictResolverContractVersion !== binding.strictResolverContractVersion ||
    api.preservedOriginReleaseSha !== binding.namespaces.origin.releaseSha ||
    !sameRuntime(api.preservedOriginRuntime, binding.namespaces.origin.runtime)
  ) {
    refuse("FROZEN_API_IDENTITY");
  }
  const graph = Object.freeze(
    Object.fromEntries(
      Object.entries(binding.namespaces).map(([name, namespace]) => [
        name,
        Object.freeze({
          root: namespace.evidence.root,
          identity: Object.freeze({
            releaseSha: namespace.releaseSha,
            runtime: namespace.runtime,
          }),
        }),
      ]),
    ),
  );
  const resolver = api.createStrictScientificEvidenceResolverV1(graph);
  if (
    resolver?.contractVersion !== binding.strictResolverContractVersion ||
    !sameIdentity(resolver.identities?.origin, binding.namespaces.origin) ||
    !sameIdentity(resolver.identities?.producer, binding.namespaces.producer) ||
    !sameIdentity(resolver.identities?.evaluator, binding.namespaces.evaluator)
  ) {
    refuse("RESOLVER_IDENTITY");
  }
  active(signal);
  const result = await api.withStrictScientificResolverV1(resolver, () =>
    api.runHistoricalTechnicalProposalCliV2(env, async (databaseUrl, input) => {
      active(signal);
      const expected = binding.proposalIdentity;
      if (
        input.preflight.organizationId !== expected.organizationId ||
        input.preflight.runId !== expected.runId ||
        input.preflight.releaseSha !== expected.releaseSha
      ) {
        refuse("PARSED_PROPOSAL_IDENTITY");
      }
      const options = api.waiaCampaignPostgresDriverOptions();
      const primaryRaw = api.postgres(databaseUrl, options);
      let eventsRaw;
      try {
        eventsRaw = api.postgres(databaseUrl, {
          ...options,
          connect_timeout: 10,
          connection: { statement_timeout: 10_000, lock_timeout: 3_000 },
        });
      } catch (error) {
        await primaryRaw.end({ timeout: 5 });
        throw error;
      }
      return api.withHistoricalLaunchCleanupV2(async () => {
        const pool = api.guardSingleConnectionPostgresPool(primaryRaw);
        const eventsPool = api.guardSingleConnectionPostgresPool(eventsRaw);
        active(signal);
        return api.prepareHistoricalTechnicalProposalOnExecutionServerV2(
          pool,
          input,
          {
            onProgress: diagnostics.onProgress,
            flushProgress: diagnostics.flushProgress,
          },
          eventsPool,
        );
      }, [() => primaryRaw.end({ timeout: 5 }), () => eventsRaw.end({ timeout: 5 })]);
    }),
  );
  active(signal);
  const proposal = result?.proposal;
  const expected = binding.proposalIdentity;
  if (
    !UUID.test(result?.id ?? "") ||
    !SHA256.test(proposal?.contentDigestHex ?? "") ||
    proposal.organizationId !== expected.organizationId ||
    proposal.runId !== expected.runId ||
    proposal.releaseSha !== expected.releaseSha
  ) {
    refuse("RESULT_IDENTITY");
  }
  return Object.freeze({
    schemaVersion: "waia.historical_strict_proposal_preparation_result.v1",
    proposalId: result.id,
    proposalContentDigestHex: proposal.contentDigestHex,
    organizationId: expected.organizationId,
    runId: expected.runId,
    evaluatorReleaseSha: expected.releaseSha,
    bindingDigest: binding.digest,
    strictResolverContractVersion: binding.strictResolverContractVersion,
    authorityGranted: false,
    finalizationInvoked: false,
  });
}

export function formatHistoricalStrictProposalFailureV1(error, verifiedFormatter) {
  if (verifiedFormatter) {
    try {
      return verifiedFormatter(error);
    } catch {
      // No unredacted fallback.
    }
  }
  const message = error instanceof Error ? error.message : "";
  return /^(?:HISTORICAL_OPR_BINDING|HISTORICAL_PREPARE_PROPOSAL)_REFUSED:[A-Z0-9_]+$/.test(message)
    ? message
    : "HISTORICAL_PREPARE_PROPOSAL_FAILED: before verified diagnostics or diagnostic formatter unavailable";
}

export async function runHistoricalStrictProposalMainV1() {
  const invocation = validateHistoricalProposalInvocationV1(
    process.argv.slice(2),
    process.execArgv,
  );
  const binding = readHistoricalOprBindingManifestV1(
    invocation.manifestPath,
    invocation.expectedDigest,
  );
  verifyHistoricalOprReleaseBindingV1(binding);
  validateHistoricalProposalBindingEnvironmentV1(binding, process.env);
  const priorCwd = process.cwd();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let loaded;
  try {
    process.chdir(binding.namespaces.evaluator.source.root);
    loaded = await loadFrozenHistoricalProposalApiV1(binding);
    const result = await prepareHistoricalProposalWithStrictResolverV1(
      { binding, env: process.env },
      loaded.api,
      controller.signal,
      {
        onProgress: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
        flushProgress: () =>
          new Promise((resolveWrite, rejectWrite) =>
            process.stderr.write("", (error) => (error ? rejectWrite(error) : resolveWrite())),
          ),
      },
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `${formatHistoricalStrictProposalFailureV1(
        error,
        loaded?.api.formatHistoricalLaunchErrorV2,
      )}\n`,
    );
    process.exitCode = 1;
  } finally {
    process.chdir(priorCwd);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await loaded?.unregister();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHistoricalStrictProposalMainV1().catch((error) => {
    process.stderr.write(`${formatHistoricalStrictProposalFailureV1(error)}\n`);
    process.exitCode = 1;
  });
}
