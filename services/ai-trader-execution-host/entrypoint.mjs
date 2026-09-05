import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createHealthServer } from "./server.mjs";

const SERVICE_NAME = "ai-trader-execution-host";
const CONSUMER_MODE = "historical-v2-ratified-one-shot";
const CONSUMER_SCRIPT = "scripts/trader/historical-simulation-v2-launch-approved.ts";
const PROPOSAL_SCRIPT = "scripts/trader/historical-simulation-v2-prepare-proposal.ts";
const RUNNER_LOGIN = "waia_historical_runner_login";
const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const FORBIDDEN_RUNTIME_KEYS = Object.freeze([
  "AI_TRADER_MASTER_KEY",
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
]);

function refuse(code) {
  throw new Error(`EXECUTION_HOST_REFUSED:${code}`);
}

function required(env, key) {
  const value = env[key]?.trim();
  if (!value) refuse(key);
  return value;
}

export function parseExecutionHostRuntimeV2(env) {
  const forbiddenKey = FORBIDDEN_RUNTIME_KEYS.find((key) => env[key]?.trim());
  if (forbiddenKey) refuse(`FORBIDDEN_RUNTIME_AUTHORITY:${forbiddenKey}`);
  const imageReleaseSha = required(env, "WAIA_IMAGE_RELEASE_SHA").toLowerCase();
  const releaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  if (!SHA.test(imageReleaseSha) || !SHA.test(releaseSha) || imageReleaseSha !== releaseSha) {
    refuse("RELEASE_SHA_MISMATCH");
  }

  const databaseUrl = required(env, "DATABASE_URL_POSTGRES_SESSION");
  let database;
  try {
    database = new URL(databaseUrl);
  } catch {
    refuse("DATABASE_URL_POSTGRES_SESSION");
  }
  if ((database.protocol !== "postgres:" && database.protocol !== "postgresql:") ||
      decodeURIComponent(database.username) !== RUNNER_LOGIN) {
    refuse("DATABASE_LOGIN_ROLE");
  }

  const organizationId = required(env, "WAIA_HISTORICAL_ORGANIZATION_ID");
  const runId = required(env, "WAIA_HISTORICAL_RUN_ID");
  if (!UUID.test(organizationId)) refuse("WAIA_HISTORICAL_ORGANIZATION_ID");
  if (!RUN_ID.test(runId)) refuse("WAIA_HISTORICAL_RUN_ID");

  return Object.freeze({ databaseUrl, imageReleaseSha, releaseSha, organizationId, runId });
}

/** Only the constrained DB secret and durable run identity cross into the child. */
export function buildHistoricalConsumerEnvironmentV2(env, config) {
  return Object.freeze({
    PATH: env.PATH,
    HOME: env.HOME,
    NODE_ENV: "production",
    WAIA_TRADER_CLI: "1",
    DATABASE_URL_POSTGRES_SESSION: config.databaseUrl,
    WAIA_RELEASE_SHA: config.releaseSha,
    WAIA_HISTORICAL_ORGANIZATION_ID: config.organizationId,
    WAIA_HISTORICAL_RUN_ID: config.runId,
  });
}

export function buildExecutionHostRuntimeHealthV2(config, consumer) {
  const ready = consumer.state === "running" || consumer.state === "completed";
  return Object.freeze({
    status: ready ? "ok" : "degraded",
    service: SERVICE_NAME,
    releaseSha: config.releaseSha,
    imageReleaseSha: config.imageReleaseSha,
    consumer: Object.freeze({
      mode: CONSUMER_MODE,
      state: consumer.state,
      runId: config.runId,
      exitCode: consumer.exitCode,
    }),
  });
}

export function runExecutionHostImagePreflightV2(env, fileExists = existsSync) {
  const imageReleaseSha = required(env, "WAIA_IMAGE_RELEASE_SHA").toLowerCase();
  const runtimeReleaseSha = required(env, "WAIA_RELEASE_SHA").toLowerCase();
  if (!SHA.test(imageReleaseSha) || imageReleaseSha !== runtimeReleaseSha) {
    refuse("RELEASE_SHA_MISMATCH");
  }
  if (!fileExists(CONSUMER_SCRIPT) || !fileExists(PROPOSAL_SCRIPT) ||
      !fileExists("node_modules/tsx")) {
    refuse("HISTORICAL_CONSUMER_NOT_PACKAGED");
  }
  return Object.freeze({
    schemaVersion: "waia.execution_host_image_preflight.v2",
    releaseSha: runtimeReleaseSha,
    consumerMode: CONSUMER_MODE,
    consumerPackaged: true,
    proposalPreparerPackaged: true,
  });
}

export function startExecutionHostSupervisorV2(options = {}) {
  const env = options.env ?? process.env;
  const config = parseExecutionHostRuntimeV2(env);
  const consumer = { state: "starting", exitCode: null };
  const createServer = options.createServer ?? createHealthServer;
  const spawnChild = options.spawnChild ?? spawn;
  const cwd = options.cwd ?? process.cwd();
  const { server, port } = createServer({
    getHealthBody: () => buildExecutionHostRuntimeHealthV2(config, consumer),
  });
  let child = null;
  let stopping = false;

  const closeServer = () => new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
  const shutdown = async (signal = "SIGTERM") => {
    if (stopping) return;
    stopping = true;
    if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
    await closeServer();
  };

  server.listen(port, () => {
    if (stopping) {
      void closeServer();
      return;
    }
    child = spawnChild(process.execPath, [
      "--import", "tsx", "--conditions=react-server", CONSUMER_SCRIPT,
    ], {
      cwd,
      env: buildHistoricalConsumerEnvironmentV2(env, config),
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    child.on("message", (message) => {
      if (!stopping && message && typeof message === "object" &&
          message.type === "waia.historical_consumer.claimed.v2") {
        consumer.state = "running";
        process.stdout.write(`[${SERVICE_NAME}] historical consumer claimed durable run\n`);
      } else if (!stopping && message && typeof message === "object" &&
          message.type === "waia.historical_consumer.completed.v2") {
        consumer.state = "completed";
        process.stdout.write(`[${SERVICE_NAME}] historical run already completed\n`);
      }
    });
    child.once("error", (error) => {
      consumer.state = "failed";
      consumer.exitCode = 1;
      process.stderr.write(`[${SERVICE_NAME}] consumer spawn failed: ${error.message}\n`);
      void shutdown("SIGTERM").then(() => process.exit(1));
    });
    child.once("exit", (code, signal) => {
      consumer.exitCode = code;
      if (stopping) return;
      if (code === 0) {
        consumer.state = "completed";
        process.stdout.write(`[${SERVICE_NAME}] historical consumer completed\n`);
        return;
      }
      consumer.state = "failed";
      process.stderr.write(
        `[${SERVICE_NAME}] historical consumer failed code=${String(code)} signal=${String(signal)}\n`,
      );
      void shutdown("SIGTERM").then(() => process.exit(code ?? 1));
    });
    process.stdout.write(
      `[${SERVICE_NAME}] listening port=${port} release=${config.releaseSha} consumer=starting\n`,
    );
  });

  return Object.freeze({ config, consumer, server, shutdown });
}

function isMainModule() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  if (process.argv.includes("--preflight-image")) {
    const result = runExecutionHostImagePreflightV2(process.env);
    await import("../../scripts/trader/historical-simulation-v2-launch-approved.ts");
    process.stdout.write(`${JSON.stringify({ ...result, consumerModuleImport: "PASS" })}\n`);
  } else if (process.argv.includes("--preflight-runtime")) {
    const config = parseExecutionHostRuntimeV2(process.env);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "waia.execution_host_runtime_preflight.v2",
      releaseSha: config.releaseSha,
      loginRole: RUNNER_LOGIN,
      consumerMode: CONSUMER_MODE,
    })}\n`);
  } else {
    const runtime = startExecutionHostSupervisorV2();
    process.once("SIGTERM", () => { void runtime.shutdown("SIGTERM"); });
    process.once("SIGINT", () => { void runtime.shutdown("SIGINT"); });
  }
}
