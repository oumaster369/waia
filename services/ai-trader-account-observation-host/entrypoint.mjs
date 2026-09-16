import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createObservationHealthServer } from "./server.mjs";

/**
 * DEE-1015: supervisor for the dedicated, credential-capable account-observation runtime.
 *
 * A separate runtime authority from `ai-trader-execution-host`: that host refuses all credential
 * material and admits only idle / historical one-shot computation, and is not modified here. This
 * host admits recurring read-only observation, owns its own health identity and port, and refuses
 * historical-runner authority, live/holdout flags, venue plaintext keys and the Cloudflare Secrets
 * Store binding name. Everything is validated before a listener opens or a consumer is spawned.
 */

const SERVICE_NAME = "ai-trader-account-observation-host";
const CONSUMER_MODE = "account-observation-recurring";
const CONSUMER_SCRIPT = "scripts/trader/account-observation-collector-host.ts";
const SERVER_ONLY_PRELUDE = "scripts/trader/trader-cli-server-only-prelude.cjs";
const CONSUMER_STARTED = "waia.account_observation_collector.started.v1";
const MANIFEST_SCHEMA = "waia.account_observation_assignment_manifest.v1";
const MANIFEST_MAX_BYTES = 65536;
const COLLECTOR_LOGIN = "waia_account_observer_login";
const READER_LOGIN = "waia_account_observation_reader_login";
const CREDENTIAL_LOGIN = "waia_account_observation_credential_login";
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const OWNER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Authority this runtime must never receive: venue plaintext keys, live/holdout enablement,
 * the Worker Secrets Store binding name, dev master-key mode, and historical Execution Server
 * database/run authority. The observation master key arrives only as the explicitly
 * service-scoped `WAIA_OBSERVATION_MASTER_KEY`.
 */
const FORBIDDEN_RUNTIME_KEYS = Object.freeze([
  "AI_TRADER_MASTER_KEY",
  "AI_TRADER_MASTER_KEY_MODE",
  "HTX_ACCESS_KEY",
  "HTX_SECRET_KEY",
  "BINANCE_API_KEY",
  "BINANCE_SECRET_KEY",
  "ALPACA_API_KEY",
  "ALPACA_SECRET_KEY",
  "IBKR_PRIVATE_KEY",
  "WAIA_TRADER_LIVE_ENABLED",
  "WAIA_LIVE_TRADING_ENABLED",
  "WAIA_BLIND_HOLDOUT_ENABLED",
  "WAIA_EXECUTION_HOST_MODE",
  "WAIA_HISTORICAL_RUN_ID",
  "WAIA_FHV_CHECKPOINT_ROOT",
  "DATABASE_URL",
  "DATABASE_URL_POSTGRES",
  "DATABASE_URL_POSTGRES_SESSION",
]);

function refuse(code) {
  throw new Error(`OBSERVATION_HOST_REFUSED:${code}`);
}

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) refuse(key);
  return value;
}

function observationDatabaseUrl(env, key, expectedLogin) {
  const value = required(env, key);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    refuse(key);
  }
  const protocol = parsed.protocol.toLowerCase();
  if ((protocol !== "postgres:" && protocol !== "postgresql:") || !parsed.hostname) refuse(key);
  if (decodeURIComponent(parsed.username) !== expectedLogin) refuse("DATABASE_LOGIN_ROLE");
  return value;
}

/**
 * Cheap early binding of the on-disk manifest to the deployed digest. The consumer still performs
 * the authoritative canonical recomputation and full semantic validation before anything opens.
 */
function assertDeclaredManifest(path, expectedDigest, releaseSha, readFile) {
  let text;
  try {
    text = readFile(path, "utf8");
  } catch {
    refuse("MANIFEST_UNREADABLE");
  }
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    Buffer.byteLength(text, "utf8") > MANIFEST_MAX_BYTES
  ) {
    refuse("MANIFEST_SIZE");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse("MANIFEST_JSON");
  }
  if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== MANIFEST_SCHEMA) {
    refuse("MANIFEST_SCHEMA");
  }
  if (parsed.contentSha256 !== expectedDigest) refuse("MANIFEST_DECLARED_DIGEST");
  if (parsed.releaseSha !== releaseSha) refuse("MANIFEST_RELEASE_SHA");
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {(path: string, encoding: 'utf8') => string} [readFile]
 */
export function parseObservationHostRuntimeV1(env, readFile = readFileSync) {
  const mode = env.WAIA_OBSERVATION_HOST_MODE ?? "idle";
  if (mode !== "idle" && mode !== CONSUMER_MODE) refuse("WAIA_OBSERVATION_HOST_MODE");
  if (env.NODE_OPTIONS !== undefined && env.NODE_OPTIONS.trim() !== "") {
    refuse("UNSAFE_CHILD_NODE_OPTIONS");
  }
  const forbiddenKey = FORBIDDEN_RUNTIME_KEYS.find((key) => env[key]?.trim());
  if (forbiddenKey) refuse(`FORBIDDEN_RUNTIME_AUTHORITY:${forbiddenKey}`);

  const imageReleaseSha = required(env, "WAIA_IMAGE_RELEASE_SHA").toLowerCase();
  const releaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  if (!SHA.test(imageReleaseSha) || !SHA.test(releaseSha) || imageReleaseSha !== releaseSha) {
    refuse("RELEASE_SHA_MISMATCH");
  }

  if (mode === "idle") {
    // Installed identity only: no database, manifest or key authority is required or accepted
    // as proof, so an installation step never needs a secret.
    return Object.freeze({
      mode,
      imageReleaseSha,
      releaseSha,
      ownerId: null,
      manifestPath: null,
      manifestSha256: null,
      collectorDatabaseUrl: null,
      readerDatabaseUrl: null,
      credentialDatabaseUrl: null,
    });
  }

  // Credential decryption is gated on a production-ready master key provider; a recurring
  // runtime on any other tier would fail closed later, so refuse it here instead.
  if (env.WAIA_DEPLOYMENT_TIER?.trim() !== "production") refuse("WAIA_DEPLOYMENT_TIER");

  const ownerId = required(env, "WAIA_OBSERVATION_OWNER_ID");
  if (!OWNER_ID.test(ownerId)) refuse("WAIA_OBSERVATION_OWNER_ID");

  const manifestPath = required(env, "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST");
  if (
    !isAbsolute(manifestPath) ||
    manifestPath.includes("\0") ||
    resolve(manifestPath) !== manifestPath ||
    manifestPath === "/"
  ) {
    refuse("WAIA_OBSERVATION_ASSIGNMENT_MANIFEST");
  }
  const manifestSha256 = required(env, "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256").toLowerCase();
  if (!DIGEST.test(manifestSha256)) refuse("WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256");
  assertDeclaredManifest(manifestPath, manifestSha256, releaseSha, readFile);

  const collectorDatabaseUrl = observationDatabaseUrl(
    env,
    "WAIA_OBSERVATION_COLLECTOR_DATABASE_URL",
    COLLECTOR_LOGIN,
  );
  const readerDatabaseUrl = observationDatabaseUrl(
    env,
    "WAIA_OBSERVATION_READER_DATABASE_URL",
    READER_LOGIN,
  );
  const credentialDatabaseUrl = observationDatabaseUrl(
    env,
    "WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL",
    CREDENTIAL_LOGIN,
  );
  const urls = [collectorDatabaseUrl, readerDatabaseUrl, credentialDatabaseUrl];
  if (new Set(urls).size !== urls.length) refuse("DATABASE_RESOURCE_NOT_DISTINCT");

  const masterKey = required(env, "WAIA_OBSERVATION_MASTER_KEY");
  const decoded = Buffer.from(masterKey, "base64");
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== masterKey) {
    refuse("WAIA_OBSERVATION_MASTER_KEY");
  }

  return Object.freeze({
    mode,
    imageReleaseSha,
    releaseSha,
    ownerId,
    manifestPath,
    manifestSha256,
    collectorDatabaseUrl,
    readerDatabaseUrl,
    credentialDatabaseUrl,
  });
}

/** Only bounded observation authority crosses into the consumer; nothing else is inherited. */
export function buildObservationConsumerEnvironment(env, config) {
  return Object.freeze({
    PATH: env.PATH,
    HOME: env.HOME,
    NODE_ENV: "production",
    WAIA_TRADER_CLI: "1",
    WAIA_DEPLOYMENT_TIER: "production",
    WAIA_RELEASE_SHA: config.releaseSha,
    WAIA_OBSERVATION_OWNER_ID: config.ownerId,
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: config.manifestPath,
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: config.manifestSha256,
    WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: config.collectorDatabaseUrl,
    WAIA_OBSERVATION_READER_DATABASE_URL: config.readerDatabaseUrl,
    WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: config.credentialDatabaseUrl,
    WAIA_OBSERVATION_MASTER_KEY: required(env, "WAIA_OBSERVATION_MASTER_KEY"),
  });
}

/** Truthful, secret-free lifecycle state. Digests and counts only. */
export function buildObservationHostRuntimeHealth(config, collector) {
  const idle = config.mode === "idle" && collector.state === "idle";
  const ready = config.mode === CONSUMER_MODE && collector.state === "running";
  return Object.freeze({
    status: idle ? "installed" : ready ? "ok" : "degraded",
    observationReady: ready,
    service: SERVICE_NAME,
    releaseSha: config.releaseSha,
    imageReleaseSha: config.imageReleaseSha,
    collector: Object.freeze({
      mode: config.mode,
      state: collector.state,
      assignments: ready ? collector.assignments : null,
      manifestSha256: ready ? config.manifestSha256 : null,
      exitCode: collector.exitCode,
    }),
  });
}

export function runObservationHostImagePreflightV1(env, fileExists = existsSync) {
  const imageReleaseSha = required(env, "WAIA_IMAGE_RELEASE_SHA").toLowerCase();
  const runtimeReleaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  if (!SHA.test(imageReleaseSha) || imageReleaseSha !== runtimeReleaseSha) {
    refuse("RELEASE_SHA_MISMATCH");
  }
  if (
    !fileExists(CONSUMER_SCRIPT) ||
    !fileExists(SERVER_ONLY_PRELUDE) ||
    !fileExists("node_modules/tsx")
  ) {
    refuse("OBSERVATION_CONSUMER_NOT_PACKAGED");
  }
  return Object.freeze({
    schemaVersion: "waia.account_observation_host_image_preflight.v1",
    releaseSha: runtimeReleaseSha,
    consumerMode: CONSUMER_MODE,
    consumerPackaged: true,
    serverOnlyPreludePackaged: true,
  });
}

export function startObservationHostSupervisorV1(options = {}) {
  const env = options.env ?? process.env;
  const config = parseObservationHostRuntimeV1(env, options.readFile ?? readFileSync);
  // Build the strict child environment before listening so invalid options cannot strand a server.
  const childEnvironment =
    config.mode === "idle" ? null : buildObservationConsumerEnvironment(env, config);
  const collector = {
    state: config.mode === "idle" ? "idle" : "starting",
    assignments: null,
    exitCode: null,
  };
  const createServer = options.createServer ?? createObservationHealthServer;
  const spawnChild = options.spawnChild ?? spawn;
  const cwd = options.cwd ?? process.cwd();
  // A failed consumer must terminate the service so the orchestrator restarts a clean process
  // rather than leave a listener claiming a collector that is not running.
  const exit = options.exit ?? ((code) => process.exit(code));
  const { server, port } = createServer({
    getHealthBody: () => buildObservationHostRuntimeHealth(config, collector),
  });
  let child = null;
  let stopping = false;

  const closeServer = () =>
    new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
    });
  const shutdown = async (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    // The consumer owns the existing bounded host drain; forward, never kill the drain.
    if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
    await closeServer();
  };

  server.listen(port, () => {
    if (stopping) {
      void closeServer();
      return;
    }
    if (config.mode === "idle") {
      process.stdout.write(
        `[${SERVICE_NAME}] installed release=${config.releaseSha} mode=idle observationReady=false\n`,
      );
      return;
    }
    child = spawnChild(
      process.execPath,
      [
        "--import",
        "tsx",
        "--require",
        SERVER_ONLY_PRELUDE,
        "--conditions=react-server",
        CONSUMER_SCRIPT,
      ],
      {
        cwd,
        env: childEnvironment,
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      },
    );
    child.on("message", (message) => {
      if (
        !stopping &&
        message &&
        typeof message === "object" &&
        message.type === CONSUMER_STARTED
      ) {
        collector.state = "running";
        collector.assignments = Number.isSafeInteger(message.assignments)
          ? message.assignments
          : null;
        process.stdout.write(
          `[${SERVICE_NAME}] collector running assignments=${String(collector.assignments)}\n`,
        );
      }
    });
    child.once("error", (error) => {
      collector.state = "failed";
      collector.exitCode = 1;
      process.stderr.write(`[${SERVICE_NAME}] consumer spawn failed: ${error.message}\n`);
      void shutdown("SIGTERM").then(() => exit(1));
    });
    child.once("exit", (code, signal) => {
      collector.exitCode = code;
      if (stopping) {
        collector.state = code === 0 ? "stopped" : "failed";
        return;
      }
      if (code === 0) {
        collector.state = "stopped";
        process.stdout.write(`[${SERVICE_NAME}] collector drained and exited\n`);
        void shutdown("SIGTERM");
        return;
      }
      collector.state = "failed";
      process.stderr.write(
        `[${SERVICE_NAME}] collector failed code=${String(code)} signal=${String(signal)}\n`,
      );
      void shutdown("SIGTERM").then(() => exit(code ?? 1));
    });
    process.stdout.write(
      `[${SERVICE_NAME}] listening port=${port} release=${config.releaseSha} collector=starting\n`,
    );
  });

  return Object.freeze({ config, collector, server, shutdown });
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  if (process.argv.includes("--preflight-image")) {
    const result = runObservationHostImagePreflightV1(process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (process.argv.includes("--preflight-runtime")) {
    const config = parseObservationHostRuntimeV1(process.env);
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: "waia.account_observation_host_runtime_preflight.v1",
        releaseSha: config.releaseSha,
        consumerMode: config.mode,
        collectorLogin: COLLECTOR_LOGIN,
        readerLogin: READER_LOGIN,
        credentialLogin: CREDENTIAL_LOGIN,
        manifestSha256: config.manifestSha256,
      })}\n`,
    );
  } else {
    const runtime = startObservationHostSupervisorV1();
    process.once("SIGTERM", () => {
      void runtime.shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
      void runtime.shutdown("SIGINT");
    });
  }
}
