// @vitest-environment node
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildObservationConsumerEnvironment,
  buildObservationHostRuntimeHealth,
  parseObservationHostRuntimeV1,
  runObservationHostImagePreflightV1,
  startObservationHostSupervisorV1,
} from "../../services/ai-trader-account-observation-host/entrypoint.mjs";
import {
  buildObservationHealthBody,
  createObservationHealthServer,
} from "../../services/ai-trader-account-observation-host/server.mjs";
import { MANIFEST_RELEASE_SHA, sealManifest } from "./account-observation-manifest-fixtures";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const HOST_DIR = path.join(REPO_ROOT, "services/ai-trader-account-observation-host");
const EXECUTION_HOST_ENTRYPOINT = path.join(
  REPO_ROOT,
  "services/ai-trader-execution-host/entrypoint.mjs",
);

const MANIFEST = sealManifest();
const MANIFEST_PATH = "/srv/waia/observation-assignments.json";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const OWNER_ID = "account-observer-host-1";

const readManifest = vi.fn((requested: string) => {
  if (requested !== MANIFEST_PATH) throw new Error("ENOENT");
  return MANIFEST.text;
});

function recurringEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    PATH: "/usr/bin",
    HOME: "/home/waia",
    WAIA_OBSERVATION_HOST_MODE: "account-observation-recurring",
    WAIA_DEPLOYMENT_TIER: "production",
    WAIA_IMAGE_RELEASE_SHA: MANIFEST_RELEASE_SHA,
    WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
    WAIA_OBSERVATION_OWNER_ID: OWNER_ID,
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: MANIFEST_PATH,
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: MANIFEST.digest,
    WAIA_OBSERVATION_COLLECTOR_DATABASE_URL:
      "postgres://waia_account_observer_login:pw@db.internal:5432/waia",
    WAIA_OBSERVATION_READER_DATABASE_URL:
      "postgres://waia_account_observation_reader_login:pw@db.internal:5432/waia",
    WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL:
      "postgres://waia_account_observation_credential_login:pw@db.internal:5432/waia",
    WAIA_OBSERVATION_MASTER_KEY: MASTER_KEY,
    ...overrides,
  };
}

function idleEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    PATH: "/usr/bin",
    WAIA_IMAGE_RELEASE_SHA: MANIFEST_RELEASE_SHA,
    WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
    ...overrides,
  };
}

const parse = (env: Record<string, string | undefined>) =>
  parseObservationHostRuntimeV1(env, readManifest);

/** Minimal stand-ins so the supervisor can be driven without a socket or a real child. */
function fakeServer() {
  const emitter = new EventEmitter() as EventEmitter & {
    listening: boolean;
    listen(port: number, callback: () => void): void;
    close(callback?: () => void): void;
  };
  emitter.listening = false;
  emitter.listen = (_port: number, callback: () => void) => {
    emitter.listening = true;
    callback();
  };
  emitter.close = (callback?: () => void) => {
    emitter.listening = false;
    callback?.();
  };
  return emitter;
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    signalCode: string | null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  return child;
}

function supervisor(env: Record<string, string | undefined>) {
  const server = fakeServer();
  const child = fakeChild();
  const spawnChild = vi.fn(() => child);
  const exit = vi.fn();
  const createServer = vi.fn(({ getHealthBody }: { getHealthBody: () => unknown }) => {
    return { server, port: 8090, getHealthBody };
  });
  const runtime = startObservationHostSupervisorV1({
    env,
    readFile: readManifest,
    createServer,
    spawnChild,
    exit,
    cwd: "/srv/waia",
  });
  const health = () => createServer.mock.calls[0][0].getHealthBody() as Record<string, unknown>;
  return { runtime, server, child, spawnChild, createServer, exit, health };
}

describe("account observation host health identity", () => {
  it("is a separate service identity from the execution host", () => {
    expect(buildObservationHealthBody()).toEqual({
      status: "installed",
      service: "ai-trader-account-observation-host",
    });
  });

  it("serves GET /health and refuses other paths", async () => {
    const { server } = createObservationHealthServer({ port: 0 });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");

    const ok = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual(buildObservationHealthBody());

    const missing = await fetch(`http://127.0.0.1:${address.port}/collect`);
    expect(missing.status).toBe(404);

    const rejected = await fetch(`http://127.0.0.1:${address.port}/health`, { method: "POST" });
    expect(rejected.status).toBeGreaterThanOrEqual(400);

    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});

describe("account observation host runtime configuration", () => {
  it("accepts the recurring observation mode with an exact declared manifest", () => {
    const config = parse(recurringEnv());

    expect(config.mode).toBe("account-observation-recurring");
    expect(config.releaseSha).toBe(MANIFEST_RELEASE_SHA);
    expect(config.manifestSha256).toBe(MANIFEST.digest);
    expect(config.ownerId).toBe(OWNER_ID);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("accepts idle installation without any database, manifest or key authority", () => {
    const config = parse(idleEnv());

    expect(config.mode).toBe("idle");
    expect(config.manifestPath).toBeNull();
    expect(config.collectorDatabaseUrl).toBeNull();
    expect(config.credentialDatabaseUrl).toBeNull();
  });

  it("refuses an unknown host mode", () => {
    expect(() => parse(recurringEnv({ WAIA_OBSERVATION_HOST_MODE: "live" }))).toThrow(
      /REFUSED:WAIA_OBSERVATION_HOST_MODE/,
    );
    expect(() =>
      parse(recurringEnv({ WAIA_OBSERVATION_HOST_MODE: "historical-one-shot" })),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_HOST_MODE/);
  });

  it.each([
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
  ])("refuses forbidden runtime authority %s", (key) => {
    expect(() => parse(recurringEnv({ [key]: "supplied" }))).toThrow(
      new RegExp(`REFUSED:FORBIDDEN_RUNTIME_AUTHORITY:${key}`),
    );
    // The same refusal applies to a merely installed image.
    expect(() => parse(idleEnv({ [key]: "supplied" }))).toThrow(
      /REFUSED:FORBIDDEN_RUNTIME_AUTHORITY/,
    );
  });

  it("refuses inherited NODE_OPTIONS", () => {
    expect(() => parse(recurringEnv({ NODE_OPTIONS: "--require /tmp/x.js" }))).toThrow(
      /REFUSED:UNSAFE_CHILD_NODE_OPTIONS/,
    );
  });

  it("requires an exact matching release identity", () => {
    expect(() => parse(recurringEnv({ WAIA_RELEASE_SHA: undefined }))).toThrow(
      /REFUSED:WAIA_RELEASE_SHA/,
    );
    expect(() => parse(recurringEnv({ WAIA_IMAGE_RELEASE_SHA: undefined }))).toThrow(
      /REFUSED:WAIA_IMAGE_RELEASE_SHA/,
    );
    expect(() => parse(recurringEnv({ WAIA_IMAGE_RELEASE_SHA: "0".repeat(40) }))).toThrow(
      /REFUSED:RELEASE_SHA_MISMATCH/,
    );
    expect(() => parse(recurringEnv({ WAIA_RELEASE_SHA: "main" }))).toThrow(
      /REFUSED:RELEASE_SHA_MISMATCH/,
    );
  });

  it("refuses a recurring runtime outside the production tier", () => {
    expect(() => parse(recurringEnv({ WAIA_DEPLOYMENT_TIER: "staging" }))).toThrow(
      /REFUSED:WAIA_DEPLOYMENT_TIER/,
    );
    expect(() => parse(recurringEnv({ WAIA_DEPLOYMENT_TIER: undefined }))).toThrow(
      /REFUSED:WAIA_DEPLOYMENT_TIER/,
    );
  });

  it("refuses a manifest that is missing, mis-declared or sealed for another release", () => {
    expect(() =>
      parse(recurringEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/srv/waia/absent.json" })),
    ).toThrow(/REFUSED:MANIFEST_UNREADABLE/);
    expect(() =>
      parse(recurringEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "relative.json" })),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_ASSIGNMENT_MANIFEST/);
    // Non-normalized paths are refused before the file is even read.
    for (const path of ["/srv/waia/../../etc/manifest.json", "/srv/waia//manifest.json"]) {
      expect(() => parse(recurringEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: path }))).toThrow(
        /REFUSED:WAIA_OBSERVATION_ASSIGNMENT_MANIFEST/,
      );
    }
    expect(() =>
      parse(recurringEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: "b".repeat(64) })),
    ).toThrow(/REFUSED:MANIFEST_DECLARED_DIGEST/);
    expect(() =>
      parse(recurringEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: "nope" })),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256/);

    const otherRelease = sealManifest({ releaseSha: "0".repeat(40) });
    expect(() => parseObservationHostRuntimeV1(recurringEnv(), () => otherRelease.text)).toThrow(
      /REFUSED:MANIFEST_DECLARED_DIGEST/,
    );
    expect(() =>
      parseObservationHostRuntimeV1(
        recurringEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: otherRelease.digest }),
        () => otherRelease.text,
      ),
    ).toThrow(/REFUSED:MANIFEST_RELEASE_SHA/);
  });

  it("refuses a manifest that is not the account-observation assignment schema", () => {
    expect(() =>
      parseObservationHostRuntimeV1(recurringEnv(), () =>
        JSON.stringify({ schemaVersion: "waia.something_else.v1" }),
      ),
    ).toThrow(/REFUSED:MANIFEST_SCHEMA/);
    expect(() => parseObservationHostRuntimeV1(recurringEnv(), () => "{ not json")).toThrow(
      /REFUSED:MANIFEST_JSON/,
    );
    expect(() => parseObservationHostRuntimeV1(recurringEnv(), () => " ".repeat(65537))).toThrow(
      /REFUSED:MANIFEST_SIZE/,
    );
  });

  it("binds every database URL to its own non-interchangeable login", () => {
    expect(() =>
      parse(recurringEnv({ WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: undefined })),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_COLLECTOR_DATABASE_URL/);
    expect(() =>
      parse(
        recurringEnv({
          WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL:
            "postgres://waia_account_observer_login:pw@db.internal:5432/waia",
        }),
      ),
    ).toThrow(/REFUSED:DATABASE_LOGIN_ROLE/);
    expect(() =>
      parse(
        recurringEnv({
          WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: "postgres://postgres:pw@db.internal:5432/waia",
        }),
      ),
    ).toThrow(/REFUSED:DATABASE_LOGIN_ROLE/);
    expect(() =>
      parse(recurringEnv({ WAIA_OBSERVATION_READER_DATABASE_URL: "https://db.internal/waia" })),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_READER_DATABASE_URL/);
  });

  it("refuses a master key that is not exactly 32 base64-encoded bytes", () => {
    for (const key of [undefined, "", Buffer.alloc(16, 1).toString("base64"), "not base64!!"]) {
      expect(() => parse(recurringEnv({ WAIA_OBSERVATION_MASTER_KEY: key }))).toThrow(
        /REFUSED:WAIA_OBSERVATION_MASTER_KEY/,
      );
    }
  });
});

describe("account observation consumer environment", () => {
  it("passes only bounded observation authority to the consumer", () => {
    const env = recurringEnv({ AWS_SECRET_ACCESS_KEY: "leak", WAIA_UNRELATED: "leak" });
    const child = buildObservationConsumerEnvironment(env, parse(recurringEnv()));

    expect(Object.keys(child).sort()).toEqual(
      [
        "HOME",
        "NODE_ENV",
        "PATH",
        "WAIA_DEPLOYMENT_TIER",
        "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST",
        "WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256",
        "WAIA_OBSERVATION_COLLECTOR_DATABASE_URL",
        "WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL",
        "WAIA_OBSERVATION_MASTER_KEY",
        "WAIA_OBSERVATION_READER_DATABASE_URL",
        "WAIA_OBSERVATION_OWNER_ID",
        "WAIA_RELEASE_SHA",
        "WAIA_TRADER_CLI",
      ].sort(),
    );
    expect(child).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(child).not.toHaveProperty("WAIA_UNRELATED");
    expect(child).not.toHaveProperty("NODE_OPTIONS");
    expect(child).not.toHaveProperty("WAIA_OBSERVATION_HOST_MODE");
    expect(child.WAIA_TRADER_CLI).toBe("1");
  });
});

describe("account observation host runtime health", () => {
  it("reports installed for an idle image and never claims observation readiness", () => {
    const config = parse(idleEnv());
    const health = buildObservationHostRuntimeHealth(config, {
      state: "idle",
      assignments: null,
      exitCode: null,
    });

    expect(health.status).toBe("installed");
    expect(health.observationReady).toBe(false);
    expect(health.collector.assignments).toBeNull();
    expect(health.collector.manifestSha256).toBeNull();
  });

  it("reports ok only once the collector is actually running", () => {
    const config = parse(recurringEnv());

    expect(
      buildObservationHostRuntimeHealth(config, {
        state: "starting",
        assignments: null,
        exitCode: null,
      }),
    ).toMatchObject({ status: "degraded", observationReady: false });

    const running = buildObservationHostRuntimeHealth(config, {
      state: "running",
      assignments: 1,
      exitCode: null,
    });
    expect(running).toMatchObject({ status: "ok", observationReady: true });
    expect(running.collector.assignments).toBe(1);
    expect(running.collector.manifestSha256).toBe(MANIFEST.digest);

    expect(
      buildObservationHostRuntimeHealth(config, {
        state: "failed",
        assignments: null,
        exitCode: 1,
      }),
    ).toMatchObject({ status: "degraded", observationReady: false });
  });

  it("never exposes secret material in health", () => {
    const config = parse(recurringEnv());
    const serialized = JSON.stringify(
      buildObservationHostRuntimeHealth(config, {
        state: "running",
        assignments: 1,
        exitCode: null,
      }),
    );

    expect(serialized).not.toContain(MASTER_KEY);
    expect(serialized).not.toContain("pw@db.internal");
    expect(serialized).not.toContain("waia_account_observer_login");
  });
});

describe("account observation host supervisor", () => {
  it("serves installed health and spawns no consumer when idle", () => {
    const s = supervisor(idleEnv());

    expect(s.spawnChild).not.toHaveBeenCalled();
    expect(s.health()).toMatchObject({ status: "installed", observationReady: false });
  });

  it("spawns the packaged consumer with the strict environment and no shell", () => {
    const s = supervisor(recurringEnv());

    expect(s.spawnChild).toHaveBeenCalledTimes(1);
    const [command, args, options] = s.spawnChild.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: Record<string, string>; stdio: unknown[] },
    ];
    expect(command).toBe(process.execPath);
    expect(args).toEqual([
      "--import",
      "tsx",
      "--require",
      "scripts/trader/trader-cli-server-only-prelude.cjs",
      "--conditions=react-server",
      "scripts/trader/account-observation-collector-host.ts",
    ]);
    expect(options.cwd).toBe("/srv/waia");
    expect(options.stdio).toEqual(["inherit", "inherit", "inherit", "ipc"]);
    expect(options).not.toHaveProperty("shell");
    expect(options.env.WAIA_OBSERVATION_MASTER_KEY).toBe(MASTER_KEY);
    expect(options.env).not.toHaveProperty("WAIA_OBSERVATION_HOST_MODE");
  });

  it("becomes ready only on the consumer's own started message", () => {
    const s = supervisor(recurringEnv());
    expect(s.health()).toMatchObject({ status: "degraded", observationReady: false });

    s.child.emit("message", { type: "waia.unrelated.v1", assignments: 9 });
    expect(s.health()).toMatchObject({ observationReady: false });

    s.child.emit("message", {
      type: "waia.account_observation_collector.started.v1",
      assignments: 1,
    });
    expect(s.health()).toMatchObject({ status: "ok", observationReady: true });
    expect((s.health().collector as { assignments: number }).assignments).toBe(1);
  });

  it("forwards SIGTERM to the consumer so the existing bounded drain owns shutdown", async () => {
    const s = supervisor(recurringEnv());
    s.child.emit("message", {
      type: "waia.account_observation_collector.started.v1",
      assignments: 1,
    });

    await s.runtime.shutdown("SIGTERM");

    expect(s.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(s.server.listening).toBe(false);
  });

  it("forwards SIGINT and is idempotent", async () => {
    const s = supervisor(recurringEnv());

    await s.runtime.shutdown("SIGINT");
    await s.runtime.shutdown("SIGINT");

    expect(s.child.kill).toHaveBeenCalledTimes(1);
    expect(s.child.kill).toHaveBeenCalledWith("SIGINT");
  });

  it("does not signal a consumer that has already exited", async () => {
    const s = supervisor(recurringEnv());
    s.child.exitCode = 0;

    await s.runtime.shutdown("SIGTERM");

    expect(s.child.kill).not.toHaveBeenCalled();
    expect(s.server.listening).toBe(false);
  });

  it("stops serving after the consumer drains cleanly", async () => {
    const s = supervisor(recurringEnv());
    s.child.emit("message", {
      type: "waia.account_observation_collector.started.v1",
      assignments: 1,
    });
    s.child.exitCode = 0;
    s.child.emit("exit", 0, null);
    await Promise.resolve();

    expect(s.health()).toMatchObject({ observationReady: false });
    expect((s.health().collector as { state: string }).state).toBe("stopped");
  });

  it("degrades, reports the exit code and terminates when the consumer fails", async () => {
    const s = supervisor(recurringEnv());
    s.child.emit("exit", 1, null);
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1));

    const health = s.health();
    expect(health).toMatchObject({ status: "degraded", observationReady: false });
    expect(health.collector).toMatchObject({ state: "failed", exitCode: 1 });
    expect(s.server.listening).toBe(false);
  });

  it("terminates when the consumer cannot be spawned at all", async () => {
    const s = supervisor(recurringEnv());
    s.child.emit("error", new Error("EACCES"));
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1));

    expect(s.health()).toMatchObject({ status: "degraded", observationReady: false });
  });

  it("does not terminate the service when shutdown was already requested", async () => {
    const s = supervisor(recurringEnv());
    await s.runtime.shutdown("SIGTERM");
    s.child.emit("exit", 0, "SIGTERM");
    await Promise.resolve();

    expect(s.exit).not.toHaveBeenCalled();
  });

  it("refuses to listen at all when configuration is invalid", () => {
    expect(() => supervisor(recurringEnv({ WAIA_OBSERVATION_MASTER_KEY: "short" }))).toThrow(
      /REFUSED:WAIA_OBSERVATION_MASTER_KEY/,
    );
  });
});

describe("account observation host packaging", () => {
  it("verifies the consumer and prelude are actually packaged", () => {
    const result = runObservationHostImagePreflightV1(idleEnv(), () => true);

    expect(result).toMatchObject({
      schemaVersion: "waia.account_observation_host_image_preflight.v1",
      releaseSha: MANIFEST_RELEASE_SHA,
      consumerMode: "account-observation-recurring",
      consumerPackaged: true,
      serverOnlyPreludePackaged: true,
    });
  });

  it("refuses an image whose consumer is missing", () => {
    expect(() => runObservationHostImagePreflightV1(idleEnv(), () => false)).toThrow(
      /REFUSED:OBSERVATION_CONSUMER_NOT_PACKAGED/,
    );
  });

  it("refuses an image whose release identity disagrees", () => {
    expect(() =>
      runObservationHostImagePreflightV1(
        idleEnv({ WAIA_IMAGE_RELEASE_SHA: "0".repeat(40) }),
        () => true,
      ),
    ).toThrow(/REFUSED:RELEASE_SHA_MISMATCH/);
  });

  it("keeps the service free of Cloudflare Worker and orchestration coupling", () => {
    const sources = ["entrypoint.mjs", "server.mjs"].map((name) =>
      readFileSync(path.join(HOST_DIR, name), "utf8"),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/getCloudflareContext|@opennextjs\/cloudflare|wrangler/);
      expect(source).not.toMatch(/placeOrder|submitOrder|cancelOrder|amendOrder|withdraw/i);
    }
  });

  it("uses one set of login role names across supervisor, consumer and operator", () => {
    const logins = [
      "waia_account_observer_login",
      "waia_account_observation_reader_login",
      "waia_account_observation_credential_login",
    ];
    const sources = [
      "services/ai-trader-account-observation-host/entrypoint.mjs",
      "scripts/trader/account-observation-collector-host.ts",
      "scripts/ops/account-observation-provision-collection-state-v1.ts",
    ].map((file) => readFileSync(path.join(REPO_ROOT, file), "utf8"));

    for (const source of sources) {
      for (const login of logins) expect(source).toContain(`"${login}"`);
    }
  });

  it("keeps the historical execution host secret refusal byte-identical in spirit and content", () => {
    const source = readFileSync(EXECUTION_HOST_ENTRYPOINT, "utf8");

    // DEE-1015 must not weaken the historical host: it still refuses master-key and venue
    // authority, and gains no observation credential mode.
    expect(source).toMatch(/const FORBIDDEN_RUNTIME_KEYS = Object\.freeze\(\[/);
    for (const key of [
      "AI_TRADER_MASTER_KEY",
      "HTX_ACCESS_KEY",
      "HTX_SECRET_KEY",
      "WAIA_TRADER_LIVE_ENABLED",
    ]) {
      expect(source).toContain(`"${key}"`);
    }
    expect(source).not.toMatch(/WAIA_OBSERVATION_MASTER_KEY/);
    expect(source).not.toMatch(/account-observation-recurring/);
  });
});
