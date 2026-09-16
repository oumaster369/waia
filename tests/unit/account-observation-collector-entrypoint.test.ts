// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { observationPoolLimits } from "@/lib/trader/account-observation/host-role-probe";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import {
  ACCOUNT_OBSERVATION_LOGIN_ROLES,
  parseAccountObservationCollectorRuntime,
  runAccountObservationCollector,
  type AccountObservationCollectorDependencies,
} from "@/scripts/trader/account-observation-collector-host";
import {
  ACCOUNT_B,
  CREDENTIAL_B,
  MANIFEST_RELEASE_SHA,
  manifestAssignment,
  sealManifest,
} from "./account-observation-manifest-fixtures";

const lifecycle = vi.hoisted(() => ({ construct: vi.fn(), run: vi.fn(), dispose: vi.fn() }));
vi.mock("@/lib/trader/account-observation/configured-runtime", () => ({
  createConfiguredHtxObservationRuntime: (input: unknown) => {
    lifecycle.construct(input);
    return { run: lifecycle.run, dispose: lifecycle.dispose };
  },
}));

const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

const goodRow = (login: string) => ({
  login,
  original_session: true,
  supported: true,
  safe_login: true,
  safe_role: true,
  can_set: true,
  exclusive_role: true,
  no_ciphertext: true,
  no_destructive: true,
  reader_no_writes: true,
  forced_rls: true,
});

function pool(login: string, overrides: Record<string, unknown> = {}) {
  const row = { ...goodRow(login), ...overrides };
  const tx = vi.fn(async (chunks: TemplateStringsArray) =>
    chunks.join("?").includes("AS login") ? [row] : [],
  );
  const sql = Object.assign(vi.fn(), {
    options: { ...observationPoolLimits },
    begin: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
  }) as unknown as Sql;
  return { sql, dispose: vi.fn(async () => {}) };
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    WAIA_TRADER_CLI: "1",
    WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
    WAIA_OBSERVATION_OWNER_ID: "account-observer-host-1",
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/srv/waia/observation-assignments.json",
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: "a".repeat(64),
    WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: `postgres://${ACCOUNT_OBSERVATION_LOGIN_ROLES.collector}:pw@db.internal:5432/waia`,
    WAIA_OBSERVATION_READER_DATABASE_URL: `postgres://${ACCOUNT_OBSERVATION_LOGIN_ROLES.reader}:pw@db.internal:5432/waia`,
    WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: `postgres://${ACCOUNT_OBSERVATION_LOGIN_ROLES.credential}:pw@db.internal:5432/waia`,
    WAIA_OBSERVATION_MASTER_KEY: MASTER_KEY,
    ...overrides,
  };
}

function collectorFixture(overrides: Record<string, string | undefined> = {}) {
  const manifest = sealManifest();
  const collector = pool("waia_account_observer_login");
  const reader = pool("waia_account_observation_reader_login");
  const credentials = {
    service: { getDecryptedCredentials: vi.fn() },
    dispose: vi.fn(async () => {}),
  };
  const report = vi.fn();
  const onStarted = vi.fn();
  const controller = new AbortController();
  const readManifest = vi.fn(() => manifest.text);
  const openCollector = vi.fn(async () => collector);
  const openReader = vi.fn(async () => reader);
  const openCredentialService = vi.fn(async () => credentials);
  const dependencies: AccountObservationCollectorDependencies = {
    env: baseEnv({
      WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: manifest.digest,
      ...overrides,
    }),
    signal: controller.signal,
    readManifest,
    openCollector,
    openReader,
    openCredentialService,
    fetchImpl: vi.fn<typeof fetch>(),
    clock: accountObservationClock,
    report,
    onStarted,
  };
  return {
    dependencies,
    manifest,
    controller,
    collector,
    reader,
    credentials,
    report,
    onStarted,
    readManifest,
    openCollector,
    openReader,
    openCredentialService,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  lifecycle.run.mockImplementation(async (signal: AbortSignal) => {
    if (signal.aborted) return;
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("account observation collector runtime configuration", () => {
  it("accepts a complete environment and keeps the master key out of the config", () => {
    const runtime = parseAccountObservationCollectorRuntime(baseEnv());

    expect(runtime.config.service).toBe("ai-trader-account-observation-host");
    expect(runtime.config.releaseSha).toBe(MANIFEST_RELEASE_SHA);
    expect(runtime.config.ownerId).toBe("account-observer-host-1");
    expect(JSON.stringify(runtime.config)).not.toContain(MASTER_KEY);
    expect(Object.values(runtime.config)).not.toContain(MASTER_KEY);
    expect(Object.isFrozen(runtime.config)).toBe(true);
  });

  it("exposes the master key only through the explicit secret getter", async () => {
    const runtime = parseAccountObservationCollectorRuntime(baseEnv());

    await expect(runtime.masterKeySecretGetter()).resolves.toBe(MASTER_KEY);
  });

  it("refuses outside the trader CLI environment", () => {
    expect(() =>
      parseAccountObservationCollectorRuntime(baseEnv({ WAIA_TRADER_CLI: undefined })),
    ).toThrow(/REFUSED:CLI_ENVIRONMENT/);
    expect(() =>
      parseAccountObservationCollectorRuntime(baseEnv({ WAIA_TRADER_CLI: "true" })),
    ).toThrow(/REFUSED:CLI_ENVIRONMENT/);
  });

  it("refuses a missing or malformed release identity", () => {
    expect(() =>
      parseAccountObservationCollectorRuntime(baseEnv({ WAIA_RELEASE_SHA: undefined })),
    ).toThrow(/REFUSED:WAIA_RELEASE_SHA/);
    expect(() =>
      parseAccountObservationCollectorRuntime(baseEnv({ WAIA_RELEASE_SHA: "   " })),
    ).toThrow(/REFUSED:WAIA_RELEASE_SHA/);
    expect(() =>
      parseAccountObservationCollectorRuntime(baseEnv({ WAIA_RELEASE_SHA: "main" })),
    ).toThrow(/REFUSED:WAIA_RELEASE_SHA/);
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({ WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA.slice(0, 7) }),
      ),
    ).toThrow(/REFUSED:WAIA_RELEASE_SHA/);
  });

  it("refuses an unusable owner identity", () => {
    for (const ownerId of [undefined, "", "owner id", "a".repeat(129), "owner/1"]) {
      expect(() =>
        parseAccountObservationCollectorRuntime(baseEnv({ WAIA_OBSERVATION_OWNER_ID: ownerId })),
      ).toThrow(/REFUSED:WAIA_OBSERVATION_OWNER_ID/);
    }
  });

  it("requires an absolute manifest path and an exact declared digest", () => {
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "observation-assignments.json" }),
      ),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_ASSIGNMENT_MANIFEST/);
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/" }),
      ),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_ASSIGNMENT_MANIFEST/);
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: "not-a-digest" }),
      ),
    ).toThrow(/REFUSED:WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256/);
  });

  it("requires an already-normalized manifest path so `..` cannot walk away from it", () => {
    for (const path of [
      "/srv/waia/../../etc/observation-assignments.json",
      "/srv/waia//observation-assignments.json",
      "/srv/waia/./observation-assignments.json",
      "/srv/waia/observation-assignments.json/",
    ]) {
      expect(() =>
        parseAccountObservationCollectorRuntime(
          baseEnv({ WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: path }),
        ),
      ).toThrow(/REFUSED:WAIA_OBSERVATION_ASSIGNMENT_MANIFEST/);
    }
  });

  it("binds each database URL to its own non-interchangeable login", () => {
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({ WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: undefined }),
      ),
    ).toThrow(/REFUSED:DATABASE_URL_REQUIRED/);
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({ WAIA_OBSERVATION_READER_DATABASE_URL: "not-a-url" }),
      ),
    ).toThrow(/REFUSED:DATABASE_URL_INVALID/);
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({ WAIA_OBSERVATION_READER_DATABASE_URL: "https://db.internal/waia" }),
      ),
    ).toThrow(/REFUSED:DATABASE_URL_INVALID/);
    // A collector login supplied where the credential login is expected.
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({
          WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: `postgres://${ACCOUNT_OBSERVATION_LOGIN_ROLES.collector}:pw@db.internal:5432/waia`,
        }),
      ),
    ).toThrow(/REFUSED:DATABASE_LOGIN_ROLE/);
    // A superuser substituted for the collector login.
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({
          WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: "postgres://postgres:pw@db.internal:5432/waia",
        }),
      ),
    ).toThrow(/REFUSED:DATABASE_LOGIN_ROLE/);
  });

  it("refuses reusing one connection string for two purposes", () => {
    const shared = `postgres://${ACCOUNT_OBSERVATION_LOGIN_ROLES.collector}:pw@db.internal:5432/waia`;
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({
          WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: shared,
          WAIA_OBSERVATION_READER_DATABASE_URL: shared,
        }),
      ),
    ).toThrow(/REFUSED:DATABASE_LOGIN_ROLE/);

    // Same login on both sides is caught by the login binding; an identical string that does
    // satisfy both bindings is impossible, so distinctness is asserted through the credential slot.
    expect(() =>
      parseAccountObservationCollectorRuntime(
        baseEnv({
          WAIA_OBSERVATION_READER_DATABASE_URL: `postgres://${ACCOUNT_OBSERVATION_LOGIN_ROLES.reader}:pw@db.internal:5432/waia?x=1`,
        }),
      ),
    ).not.toThrow();
  });

  it("refuses a master key that is not exactly 32 base64-encoded bytes", () => {
    for (const key of [
      undefined,
      "",
      "not base64!!",
      Buffer.alloc(16, 1).toString("base64"),
      Buffer.alloc(64, 1).toString("base64"),
      Buffer.alloc(32, 1).toString("hex"),
    ]) {
      expect(() =>
        parseAccountObservationCollectorRuntime(baseEnv({ WAIA_OBSERVATION_MASTER_KEY: key })),
      ).toThrow(/REFUSED:WAIA_OBSERVATION_MASTER_KEY/);
    }
  });
});

describe("account observation collector composition", () => {
  it("opens nothing when the environment is invalid", async () => {
    const f = collectorFixture({ WAIA_RELEASE_SHA: "main" });

    await expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      /REFUSED:WAIA_RELEASE_SHA/,
    );
    expect(f.readManifest).not.toHaveBeenCalled();
    expect(f.openCollector).not.toHaveBeenCalled();
    expect(f.openReader).not.toHaveBeenCalled();
    expect(f.openCredentialService).not.toHaveBeenCalled();
  });

  it("refuses an unreadable manifest without opening protected resources", async () => {
    const f = collectorFixture();
    f.readManifest.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    await expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      /REFUSED:MANIFEST_UNREADABLE/,
    );
    expect(f.openCollector).not.toHaveBeenCalled();
    expect(f.openCredentialService).not.toHaveBeenCalled();
  });

  it("refuses a manifest whose digest does not match the approved one", async () => {
    const f = collectorFixture();
    const substituted = sealManifest({
      assignments: [
        manifestAssignment({ credentialId: CREDENTIAL_B, exchangeAccountId: ACCOUNT_B }),
      ],
    });
    f.readManifest.mockImplementation(() => substituted.text);

    await expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      /MANIFEST_REFUSED:EXPECTED_DIGEST/,
    );
    expect(f.openCollector).not.toHaveBeenCalled();
    expect(f.openCredentialService).not.toHaveBeenCalled();
  });

  it("refuses a malformed manifest before opening protected resources", async () => {
    const f = collectorFixture();
    f.readManifest.mockImplementation(() => "{ not json");

    await expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      /MANIFEST_REFUSED:JSON/,
    );
    expect(f.openCollector).not.toHaveBeenCalled();
  });

  it("refuses a duplicate account assignment before opening protected resources", async () => {
    const duplicate = sealManifest({
      assignments: [manifestAssignment(), manifestAssignment({ credentialId: CREDENTIAL_B })],
    });
    const f = collectorFixture({
      WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: duplicate.digest,
    });
    f.readManifest.mockImplementation(() => duplicate.text);

    await expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      /MANIFEST_REFUSED:DUPLICATE_ACCOUNT/,
    );
    expect(f.openCollector).not.toHaveBeenCalled();
    expect(f.openCredentialService).not.toHaveBeenCalled();
  });

  it("composes the existing host over distinct resources and drains on cancellation", async () => {
    const f = collectorFixture();
    const work = runAccountObservationCollector(f.dependencies);
    await vi.advanceTimersByTimeAsync(0);

    expect(f.openCollector).toHaveBeenCalledWith(expect.any(AbortSignal), observationPoolLimits);
    expect(f.openReader).toHaveBeenCalledWith(expect.any(AbortSignal), observationPoolLimits);
    expect(lifecycle.construct).toHaveBeenCalledTimes(1);
    const composed = lifecycle.construct.mock.calls[0][0];
    expect(composed.collectorSql).toBe(f.collector.sql);
    expect(composed.readerSql).toBe(f.reader.sql);
    expect(composed.collectorSql).not.toBe(composed.readerSql);
    expect(composed.protectedCredentialService).toBe(f.credentials.service);
    expect(composed.ownerId).toBe("account-observer-host-1");
    expect(composed.host).toBe("api.huobi.pro");
    expect(composed.configured).toHaveLength(1);
    expect(f.report.mock.calls.flat()).toContain("HOST_STARTED");

    f.controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await work;

    for (const resource of [f.collector, f.reader, f.credentials]) {
      expect(resource.dispose).toHaveBeenCalledTimes(1);
    }
    expect(lifecycle.dispose).toHaveBeenCalledTimes(1);
    expect(f.report.mock.calls.flat()).toEqual(["HOST_STARTED", "HOST_STOPPED"]);
  });

  it("opens the credential service only after both database sessions are attested", async () => {
    const f = collectorFixture();
    const work = runAccountObservationCollector(f.dependencies);
    await vi.advanceTimersByTimeAsync(0);

    const credentialOrder = f.openCredentialService.mock.invocationCallOrder[0];
    expect(credentialOrder).toBeGreaterThan(
      vi.mocked(f.collector.sql.begin).mock.invocationCallOrder[0],
    );
    expect(credentialOrder).toBeGreaterThan(
      vi.mocked(f.reader.sql.begin).mock.invocationCallOrder[0],
    );

    f.controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await work;
  });

  it("reports sanitized identity to the supervisor without any secret material", async () => {
    const f = collectorFixture();
    const work = runAccountObservationCollector(f.dependencies);
    await vi.advanceTimersByTimeAsync(0);

    expect(f.onStarted).toHaveBeenCalledTimes(1);
    const started = f.onStarted.mock.calls[0][0];
    expect(started.assignments).toBe(1);
    expect(started.manifestSha256).toBe(f.manifest.digest);
    expect(started.releaseSha).toBe(MANIFEST_RELEASE_SHA);
    expect(typeof started.stop).toBe("function");
    expect(JSON.stringify({ ...started, stop: undefined })).not.toContain(MASTER_KEY);

    await started.stop();
    await work;
    expect(f.report.mock.calls.flat()).toEqual(["HOST_STARTED", "HOST_STOPPED"]);
  });

  it("fails closed and disposes when the collector session presents the wrong role", async () => {
    const f = collectorFixture();
    f.openCollector.mockImplementation(async () =>
      pool("waia_account_observer_login", { can_set: false }),
    );
    const failed = expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      "ACCOUNT_OBSERVATION_HOST_FAILED",
    );
    await vi.advanceTimersByTimeAsync(0);
    await failed;

    expect(f.openCredentialService).not.toHaveBeenCalled();
    expect(lifecycle.construct).not.toHaveBeenCalled();
    expect(f.report.mock.calls.flat()).toEqual(["HOST_FAILED"]);
  });

  it("fails closed when the reader session is not a distinct login", async () => {
    const f = collectorFixture();
    f.openReader.mockImplementation(async () => pool("waia_account_observer_login"));
    const failed = expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      "ACCOUNT_OBSERVATION_HOST_FAILED",
    );
    await vi.advanceTimersByTimeAsync(0);
    await failed;

    expect(f.openCredentialService).not.toHaveBeenCalled();
    expect(lifecycle.construct).not.toHaveBeenCalled();
  });

  it("cleans up when the credential service cannot open", async () => {
    const f = collectorFixture();
    f.openCredentialService.mockImplementation(async () => {
      throw new Error("CREDENTIAL_OPEN_FAILED");
    });
    const failed = expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      "ACCOUNT_OBSERVATION_HOST_FAILED",
    );
    await vi.advanceTimersByTimeAsync(0);
    await failed;

    expect(lifecycle.construct).not.toHaveBeenCalled();
    expect(f.collector.dispose).toHaveBeenCalledTimes(1);
    expect(f.reader.dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans up every owned resource when the recurring run fails", async () => {
    const f = collectorFixture();
    lifecycle.run.mockImplementation(async () => {
      throw new Error("RUNTIME_FAILED");
    });
    const failed = expect(runAccountObservationCollector(f.dependencies)).rejects.toThrow(
      "ACCOUNT_OBSERVATION_HOST_FAILED",
    );
    await vi.advanceTimersByTimeAsync(0);
    await failed;

    for (const resource of [f.collector, f.reader, f.credentials]) {
      expect(resource.dispose).toHaveBeenCalledTimes(1);
    }
    expect(lifecycle.dispose).toHaveBeenCalledTimes(1);
    expect(f.report.mock.calls.flat()).toContain("HOST_FAILED");
  });

  it("returns immediately without opening when cancelled before start", async () => {
    const f = collectorFixture();
    f.controller.abort();

    await runAccountObservationCollector(f.dependencies);

    expect(f.openCollector).not.toHaveBeenCalled();
    expect(f.openCredentialService).not.toHaveBeenCalled();
    expect(lifecycle.construct).not.toHaveBeenCalled();
  });
});
