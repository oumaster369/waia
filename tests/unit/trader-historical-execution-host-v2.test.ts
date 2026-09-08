import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createHealthServer } from "../../services/ai-trader-execution-host/server.mjs";

import { describe, expect, it, vi } from "vitest";

import {
  buildExecutionHostRuntimeHealthV2,
  buildHistoricalConsumerEnvironmentV2,
  historicalChildHeapOptionsV2,
  parseExecutionHostRuntimeV2,
  runExecutionHostImagePreflightV2,
  startExecutionHostSupervisorV2,
} from "../../services/ai-trader-execution-host/entrypoint.mjs";

const env = Object.freeze({
  WAIA_EXECUTION_HOST_MODE: "historical-v2-ratified-one-shot",
  PATH: "/usr/bin",
  HOME: "/home/waia",
  WAIA_IMAGE_RELEASE_SHA: "a".repeat(40),
  WAIA_RELEASE_SHA: "a".repeat(40),
  DATABASE_URL_POSTGRES_SESSION:
    "postgresql://waia_historical_runner_login:secret@db.invalid:5432/postgres",
  WAIA_HISTORICAL_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  WAIA_HISTORICAL_RUN_ID: "observed-walk-forward-35",
  WAIA_FHV_CHECKPOINT_ROOT: "/var/lib/waia/scientific-checkpoints",
});

describe("Historical Simulation V2 execution-host supervisor", () => {
  it("serves truthful idle HTTP health and shuts down without a consumer", async () => {
    const spawnChild = vi.fn(() => { throw new Error("no computation allowed"); });
    const runtime = startExecutionHostSupervisorV2({
      env: { ...env, WAIA_EXECUTION_HOST_MODE: undefined }, spawnChild,
      createServer: (options: { getHealthBody: () => Record<string, unknown> }) =>
        createHealthServer({ ...options, port: 0 }),
    });
    try {
      if (!runtime.server.listening) await once(runtime.server, "listening");
      const address = runtime.server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "installed", executionReady: false, consumer: { mode: "idle", state: "idle", runId: null },
      });
      expect(spawnChild).not.toHaveBeenCalled();
    } finally { await runtime.shutdown(); }
  });

  it.each(["idle", "historical-v2-ratified-one-shot"])("preserves authority/identity guards in %s", (mode) => {
    for (const [patch, code] of [
      [{ WAIA_RELEASE_SHA: "b".repeat(40) }, "RELEASE_SHA_MISMATCH"],
      [{ DATABASE_URL_POSTGRES_SESSION: "postgresql://postgres:secret@db.invalid/postgres" }, "DATABASE_LOGIN_ROLE"],
      [{ HTX_SECRET_KEY: "forbidden" }, "FORBIDDEN_RUNTIME_AUTHORITY"],
      [{ WAIA_FHV_CHECKPOINT_ROOT: "/" }, "WAIA_FHV_CHECKPOINT_ROOT"],
    ] as const) {
      const createServer = vi.fn();
      expect(() => startExecutionHostSupervisorV2({
        env: { ...env, WAIA_EXECUTION_HOST_MODE: mode, ...patch }, createServer,
      })).toThrow(code);
      expect(createServer).not.toHaveBeenCalled();
    }
  });

  it.each([undefined, "idle"])("installs idle without spawning computation (mode=%s)", async (mode) => {
    const spawnChild = vi.fn(() => { throw new Error("idle must never spawn"); });
    const server = {
      listening: false,
      listen: (_port: number, callback: () => void) => { server.listening = true; callback(); },
      close: (callback: () => void) => { server.listening = false; callback(); },
    };
    let health: (() => Record<string, unknown>) | undefined;
    const runtime = startExecutionHostSupervisorV2({
      env: { ...env, WAIA_EXECUTION_HOST_MODE: mode }, spawnChild,
      createServer: (options: { getHealthBody: () => Record<string, unknown> }) => {
        health = options.getHealthBody;
        return { server, port: 8080 };
      },
    });
    expect(spawnChild).not.toHaveBeenCalled();
    expect(health?.()).toMatchObject({
      status: "installed", executionReady: false,
      releaseSha: env.WAIA_RELEASE_SHA,
      consumer: { mode: "idle", state: "idle", runId: null, exitCode: null },
    });
    await runtime.shutdown();
    expect(server.listening).toBe(false);
  });

  it.each(["", "active", "live", " idle", "idle "])("refuses invalid runtime mode %s before listening", (mode) => {
    const createServer = vi.fn();
    expect(() => startExecutionHostSupervisorV2({ env: { ...env, WAIA_EXECUTION_HOST_MODE: mode }, createServer }))
      .toThrow("WAIA_EXECUTION_HOST_MODE");
    expect(createServer).not.toHaveBeenCalled();
  });

  it("forwards the validated checkpoint mount to the actual Node child adapter", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "waia-host-checkpoint-")));
    try {
      const selected = { ...env, WAIA_FHV_CHECKPOINT_ROOT: root };
      const config = parseExecutionHostRuntimeV2(selected);
      selected.WAIA_FHV_CHECKPOINT_ROOT = "/must-not-replace-validated-root";
      const childEnv = buildHistoricalConsumerEnvironmentV2(selected, config);
      expect(childEnv.WAIA_FHV_CHECKPOINT_ROOT).toBe(root);
      const child = spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "-e",
        "const { createScientificCheckpointStoreV1 } = require('./scripts/trader/scientific-checkpoint-store-v1.ts'); " +
        "const store = createScientificCheckpointStoreV1(process.env.WAIA_FHV_CHECKPOINT_ROOT, process.env.WAIA_RELEASE_SHA); " +
        "console.log(JSON.stringify(store.evidence('host-child-proof', {runId: process.env.WAIA_HISTORICAL_RUN_ID}, () => ({preserved: true}))));"],
      { env: childEnv, encoding: "utf8", timeout: 15_000 });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ preserved: true });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each([undefined, "", "relative/cache", "/", "/tmp/..", "/tmp/invalid\u0000root"])(
    "rejects a missing or unsafe checkpoint root before opening the server: %s", (root) => {
      expect(() => parseExecutionHostRuntimeV2({ ...env, WAIA_FHV_CHECKPOINT_ROOT: root }))
        .toThrow("WAIA_FHV_CHECKPOINT_ROOT");
    },
  );

  it("propagates the explicit heap limit to a real Node child without other host authority", () => {
    const childEnv = buildHistoricalConsumerEnvironmentV2({
      ...env, NODE_OPTIONS: "--max-old-space-size=24576", HTX_SECRET_KEY: "not-forwarded",
    }, parseExecutionHostRuntimeV2(env));
    const child = spawnSync(process.execPath, ["--input-type=module", "-e",
      "import v8 from 'node:v8'; console.log(JSON.stringify({heap: v8.getHeapStatistics().heap_size_limit / 1048576, secretPresent: 'HTX_SECRET_KEY' in process.env}));"],
    { env: childEnv, encoding: "utf8", timeout: 10_000 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    const measured = JSON.parse(child.stdout);
    expect(measured.heap).toBeGreaterThanOrEqual(24576);
    expect(measured.heap).toBeLessThan(25000);
    expect(measured.secretPresent).toBe(false);
  });

  it.each([
    "--require=/tmp/injected.cjs", "--import=data:text/javascript,process.exit()",
    "--max-old-space-size=24576 --require=/tmp/injected.cjs",
    "--max-old-space-size=24576 --inspect=0.0.0.0:9229",
    "--max-old-space-size=24576 --max-old-space-size=512",
    "--max-old-space-size=0", "--max-old-space-size=32769",
    "--max-old-space-size=1e4", "--max-old-space-size=24576\n--require=x",
  ])("rejects unsafe or unbounded child NODE_OPTIONS: %s", (value) => {
    expect(() => historicalChildHeapOptionsV2(value)).toThrow("UNSAFE_CHILD_NODE_OPTIONS");
  });

  it("does not invent a heap setting and normalizes the sole supported capacity option", () => {
    expect(historicalChildHeapOptionsV2(undefined)).toBeUndefined();
    expect(historicalChildHeapOptionsV2(" ")).toBeUndefined();
    expect(historicalChildHeapOptionsV2("--max_old_space_size 24576"))
      .toBe("--max-old-space-size=24576");
  });

  it("binds runtime identity to the baked SHA and dedicated LOGIN", () => {
    expect(parseExecutionHostRuntimeV2(env)).toMatchObject({
      releaseSha: "a".repeat(40),
      imageReleaseSha: "a".repeat(40),
      runId: env.WAIA_HISTORICAL_RUN_ID,
    });
    expect(() => parseExecutionHostRuntimeV2({
      ...env, WAIA_RELEASE_SHA: "b".repeat(40),
    })).toThrow("RELEASE_SHA_MISMATCH");
    expect(() => parseExecutionHostRuntimeV2({
      ...env, DATABASE_URL_POSTGRES_SESSION: "postgresql://postgres:secret@db.invalid/postgres",
    })).toThrow("DATABASE_LOGIN_ROLE");
    expect(() => parseExecutionHostRuntimeV2({
      ...env, HTX_SECRET_KEY: "forbidden",
    })).toThrow("FORBIDDEN_RUNTIME_AUTHORITY:HTX_SECRET_KEY");
  });

  it("passes only historical run authority to the child", () => {
    const config = parseExecutionHostRuntimeV2(env);
    const child = buildHistoricalConsumerEnvironmentV2({
      ...env,
      UNRELATED_HOST_VALUE: "must-not-reach-child",
    }, config);
    expect(child).toMatchObject({
      WAIA_TRADER_CLI: "1",
      WAIA_RELEASE_SHA: env.WAIA_RELEASE_SHA,
      WAIA_HISTORICAL_ORGANIZATION_ID: env.WAIA_HISTORICAL_ORGANIZATION_ID,
      WAIA_HISTORICAL_RUN_ID: env.WAIA_HISTORICAL_RUN_ID,
    });
    expect(child).not.toHaveProperty("UNRELATED_HOST_VALUE");
    expect(child).not.toHaveProperty("WAIA_HISTORICAL_PARTITION");
  });

  it("proves the exact consumer is packaged before deployment", () => {
    const exists = vi.fn((path: unknown) => [
      "scripts/trader/historical-simulation-v2-launch-approved.ts",
      "scripts/trader/historical-simulation-v2-prepare-proposal.ts",
      "node_modules/tsx",
      "scripts/trader/validation-bootstrap-node-pool.ts",
      "scripts/trader/validation-bootstrap-range-worker.mjs",
    ].includes(String(path)));
    expect(runExecutionHostImagePreflightV2(env, exists)).toEqual({
      schemaVersion: "waia.execution_host_image_preflight.v2",
      releaseSha: "a".repeat(40),
      consumerMode: "historical-v2-ratified-one-shot",
      consumerPackaged: true,
      proposalPreparerPackaged: true,
    });
    expect(() => runExecutionHostImagePreflightV2(env, () => false))
      .toThrow("HISTORICAL_CONSUMER_NOT_PACKAGED");
    expect(() => runExecutionHostImagePreflightV2(env, path => !String(path).includes("range-worker")))
      .toThrow("VALIDATION_BOOTSTRAP_NOT_PACKAGED");
  });

  it("passes only the validated, optional worker count without adding authority", () => {
    expect(buildHistoricalConsumerEnvironmentV2(env, parseExecutionHostRuntimeV2(env)))
      .not.toHaveProperty("WAIA_FHV_VALIDATION_WORKERS");
    const selected = { ...env, WAIA_FHV_VALIDATION_WORKERS: "4" };
    const config = parseExecutionHostRuntimeV2(selected);
    selected.WAIA_FHV_VALIDATION_WORKERS = "99";
    expect(buildHistoricalConsumerEnvironmentV2(selected, config).WAIA_FHV_VALIDATION_WORKERS).toBe("4");
    for (const value of ["", "0", "5", "1.5", "04", " 2", "Infinity"]) {
      expect(() => parseExecutionHostRuntimeV2({ ...env, WAIA_FHV_VALIDATION_WORKERS: value }))
        .toThrow("WAIA_FHV_VALIDATION_WORKERS");
    }
  });

  it("packages the proposal preparer and only the canonical approved launch entrypoint", () => {
    const dockerfile = readFileSync(
      "services/ai-trader-execution-host/Dockerfile",
      "utf8",
    );
    expect(dockerfile).toContain(
      "COPY scripts/trader/historical-simulation-v2-launch-approved.ts",
    );
    expect(dockerfile).toContain(
      "COPY scripts/trader/historical-simulation-v2-prepare-proposal.ts",
    );
    expect(dockerfile).toContain("COPY scripts/trader/validation-bootstrap-node-pool.ts");
    expect(dockerfile).toContain("COPY scripts/trader/validation-bootstrap-range-worker.mjs");
    expect(dockerfile).not.toContain(
      "COPY scripts/trader/historical-simulation-v2-launch-consumer.ts",
    );
    const entrypoint = readFileSync(
      "services/ai-trader-execution-host/entrypoint.mjs",
      "utf8",
    );
    expect(entrypoint).toContain("historical-simulation-v2-launch-approved.ts");
    expect(entrypoint).not.toContain("historical-simulation-v2-launch-consumer.ts");

    const approvedLaunch = readFileSync(
      "scripts/trader/historical-simulation-v2-launch-approved.ts",
      "utf8",
    );
    expect(approvedLaunch).toContain(
      "bindPostgresReservedSession(pool, reserved)",
    );
    expect(approvedLaunch).toContain("sql: bound");
  });

  it("spawns exactly one consumer, keeps health after success, and forwards shutdown", async () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(),
    });
    let health: (() => Record<string, unknown>) | undefined;
    const server = {
      listening: false,
      listen: vi.fn((_port: number, callback: () => void) => {
        server.listening = true;
        callback();
      }),
      close: vi.fn((callback: () => void) => {
        server.listening = false;
        callback();
      }),
    };
    const spawnChild = vi.fn(() => child);
    const runtime = startExecutionHostSupervisorV2({
      env,
      cwd: "/app",
      createServer: (options: { getHealthBody: () => Record<string, unknown> }) => {
        health = options.getHealthBody;
        return { server, port: 8080 };
      },
      spawnChild,
    });

    expect(spawnChild).toHaveBeenCalledOnce();
    expect(health?.()).toMatchObject({ status: "degraded", consumer: { state: "starting" } });
    child.emit("message", { type: "waia.historical_consumer.claimed.v2" });
    expect(health?.()).toEqual(buildExecutionHostRuntimeHealthV2(runtime.config, {
      state: "running", exitCode: null,
    }));
    child.exitCode = 0;
    child.emit("exit", 0, null);
    expect(runtime.consumer.state).toBe("completed");
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(server.listening).toBe(true);

    await runtime.shutdown("SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
    expect(server.close).toHaveBeenCalledOnce();
  });

  it("stays degraded before claim and treats a terminal restart as healthy without respawn", () => {
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(),
    });
    let health: (() => Record<string, unknown>) | undefined;
    const server = {
      listening: false,
      listen: vi.fn((_port: number, callback: () => void) => {
        server.listening = true;
        callback();
      }),
      close: vi.fn((callback: () => void) => callback()),
    };
    const spawnChild = vi.fn(() => child);
    const runtime = startExecutionHostSupervisorV2({
      env,
      cwd: "/app",
      createServer: (options: { getHealthBody: () => Record<string, unknown> }) => {
        health = options.getHealthBody;
        return { server, port: 8080 };
      },
      spawnChild,
    });

    child.emit("message", { type: "waia.historical_consumer.ready.v2" });
    expect(health?.()).toMatchObject({
      status: "degraded", consumer: { state: "starting" },
    });
    child.emit("message", { type: "waia.historical_consumer.completed.v2" });
    expect(health?.()).toMatchObject({
      status: "ok", consumer: { state: "completed" },
    });
    child.exitCode = 0;
    child.emit("exit", 0, null);
    expect(runtime.consumer.state).toBe("completed");
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(server.listening).toBe(true);
  });
});
