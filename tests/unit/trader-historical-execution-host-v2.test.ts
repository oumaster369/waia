import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  buildExecutionHostRuntimeHealthV2,
  buildHistoricalConsumerEnvironmentV2,
  parseExecutionHostRuntimeV2,
  runExecutionHostImagePreflightV2,
  startExecutionHostSupervisorV2,
} from "../../services/ai-trader-execution-host/entrypoint.mjs";

const env = Object.freeze({
  PATH: "/usr/bin",
  HOME: "/home/waia",
  WAIA_IMAGE_RELEASE_SHA: "a".repeat(40),
  WAIA_RELEASE_SHA: "a".repeat(40),
  DATABASE_URL_POSTGRES_SESSION:
    "postgresql://waia_historical_runner_login:secret@db.invalid:5432/postgres",
  WAIA_HISTORICAL_ORGANIZATION_ID: "11111111-1111-4111-8111-111111111111",
  WAIA_HISTORICAL_RUN_ID: "observed-walk-forward-35",
});

describe("Historical Simulation V2 execution-host supervisor", () => {
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
