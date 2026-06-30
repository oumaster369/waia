import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { resetPostgresSingletonForTests } from "@/db/postgres-client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const mocks = vi.hoisted(() => ({
  getWaiaRuntimeDb: vi.fn(),
  disposeWaiaRuntimeDb: vi.fn().mockResolvedValue(undefined),
  buildLiveCliPostgresDeps: vi.fn(),
  createPostgresOrgLiveEnableService: vi.fn(),
  runLiveCycleOnce: vi.fn(),
  createLiveHtxConnector: vi.fn().mockResolvedValue({}),
  createLiveConnectorForMode: vi.fn().mockReturnValue({}),
}));

vi.mock("@/db/waia-runtime-db", () => ({
  getWaiaRuntimeDb: (...args: unknown[]) => mocks.getWaiaRuntimeDb(...args),
  disposeWaiaRuntimeDb: (...args: unknown[]) => mocks.disposeWaiaRuntimeDb(...args),
}));

vi.mock("@/lib/trader/live/build-live-cli-deps", () => ({
  buildLiveCliPostgresDeps: (...args: unknown[]) => mocks.buildLiveCliPostgresDeps(...args),
}));

vi.mock("@/lib/trader/live/org-live-enable-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trader/live/org-live-enable-service")>();
  return {
    ...actual,
    createPostgresOrgLiveEnableService: (...args: unknown[]) =>
      mocks.createPostgresOrgLiveEnableService(...args),
  };
});

vi.mock("@/lib/trader/live", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trader/live")>();
  return {
    ...actual,
    runLiveCycleOnce: (...args: unknown[]) => mocks.runLiveCycleOnce(...args),
    createLiveHtxConnector: (...args: unknown[]) => mocks.createLiveHtxConnector(...args),
    createLiveConnectorForMode: (...args: unknown[]) => mocks.createLiveConnectorForMode(...args),
  };
});

import { HANDLERS, parseFlags } from "@/scripts/trader/live-cli";

const USER_ID = "00000000-0000-4000-8000-0000000212e";
const FIXTURE = "tests/fixtures/trader/btcusdt-1m-mean-reversion.json";

const cycleResult = {
  submitBlocked: false,
  evaluation: { signals: [] },
  strategyStage: null,
  execution: null,
  reconciliation: null,
  reporting: null,
};

describe("trader live-cli Postgres wiring (IMP-U1 S7 / S8)", () => {
  let orgId: string;
  let sqliteDatabaseUrl: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-live-cli-wiring-"));
    sqliteDatabaseUrl = `file:${path.join(tmpDir, "live-cli-wiring.sqlite")}`;
    process.env.DATABASE_URL = sqliteDatabaseUrl;
    delete process.env.WAIA_DB_BACKEND;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "live-cli-wiring@example.com",
      password: "password123",
    });
    orgId = ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Live CLI Wiring" });
    process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = orgId;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    mocks.disposeWaiaRuntimeDb.mockResolvedValue(undefined);
    process.env.DATABASE_URL = sqliteDatabaseUrl;
    delete process.env.WAIA_DB_BACKEND;
    delete process.env.DATABASE_URL_POSTGRES;
    process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = orgId;
    resetWaiaSqliteSingleton();
    await resetPostgresSingletonForTests();
  });

  it("status on postgres backend uses runtime org-live service and disposes", async () => {
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://127.0.0.1:54329/waia_validate";

    const mockDb = { kind: "postgres-db-mock" };
    const runtime = { kind: "postgres" as const, db: mockDb };
    mocks.getWaiaRuntimeDb.mockResolvedValue(runtime);

    const preview = vi.fn().mockResolvedValue({
      state: null,
      confirmable: false,
      enableEligible: false,
      remainingMs: 0,
    });
    mocks.createPostgresOrgLiveEnableService.mockReturnValue({ preview });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await HANDLERS.status.run(parseFlags([`--org-id=${orgId}`], HANDLERS.status.allowed));

    expect(mocks.getWaiaRuntimeDb).toHaveBeenCalledOnce();
    expect(mocks.createPostgresOrgLiveEnableService).toHaveBeenCalledWith(mockDb);
    expect(preview).toHaveBeenCalledOnce();
    expect(mocks.disposeWaiaRuntimeDb).toHaveBeenCalledWith(runtime);
    expect(mocks.buildLiveCliPostgresDeps).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[trader:live] status orgId=${orgId}`),
    );

    logSpy.mockRestore();
  });

  it("fail-closed when postgres backend resolves to non-postgres runtime", async () => {
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://127.0.0.1:54329/waia_validate";
    mocks.getWaiaRuntimeDb.mockResolvedValue({ kind: "sqlite", db: getDb() });

    await expect(
      HANDLERS.status.run(parseFlags([`--org-id=${orgId}`], HANDLERS.status.allowed)),
    ).rejects.toThrow(/Postgres backend requires WAIA_DB_BACKEND=postgres/);
    expect(mocks.disposeWaiaRuntimeDb).toHaveBeenCalled();
  });

  it("cycle on postgres backend builds factory deps and disposes", async () => {
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://127.0.0.1:54329/waia_validate";

    const dispose = vi.fn().mockResolvedValue(undefined);
    mocks.buildLiveCliPostgresDeps.mockResolvedValue({
      deps: {},
      orgLiveEnableService: {
        getState: vi.fn().mockResolvedValue({ maxNotionalCap: "100" }),
      },
      dispose,
    });
    mocks.runLiveCycleOnce.mockResolvedValue(cycleResult);

    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await HANDLERS.cycle.run(
      parseFlags(
        [
          `--org-id=${orgId}`,
          "--account-key=acct",
          "--exchange-account-id=ex-1",
          "--strategy=mean_reversion_v0",
          "--version=1",
          "--credential-id=cred-1",
          `--fixture-path=${FIXTURE}`,
        ],
        HANDLERS.cycle.allowed,
      ),
    );

    expect(mocks.buildLiveCliPostgresDeps).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        credentialId: "cred-1",
      }),
    );
    expect(mocks.runLiveCycleOnce).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.getWaiaRuntimeDb).not.toHaveBeenCalled();
  });

  it("cycle on sqlite backend does not invoke postgres factory", async () => {
    delete process.env.WAIA_DB_BACKEND;
    mocks.runLiveCycleOnce.mockResolvedValue(cycleResult);

    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await HANDLERS.cycle.run(
      parseFlags(
        [
          `--org-id=${orgId}`,
          "--account-key=acct",
          "--exchange-account-id=ex-1",
          "--strategy=mean_reversion_v0",
          "--version=1",
          "--credential-id=cred-1",
          `--fixture-path=${FIXTURE}`,
        ],
        HANDLERS.cycle.allowed,
      ),
    );

    expect(mocks.buildLiveCliPostgresDeps).not.toHaveBeenCalled();
    expect(mocks.getWaiaRuntimeDb).not.toHaveBeenCalled();
    expect(mocks.runLiveCycleOnce).toHaveBeenCalledOnce();
  });

  it("sqlite status uses local db without postgres runtime", async () => {
    delete process.env.WAIA_DB_BACKEND;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await HANDLERS.status.run(parseFlags([`--org-id=${orgId}`], HANDLERS.status.allowed));

    expect(mocks.getWaiaRuntimeDb).not.toHaveBeenCalled();
    expect(mocks.buildLiveCliPostgresDeps).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[trader:live] status orgId=${orgId}`),
    );

    logSpy.mockRestore();
  });
});

describe("trader live-cli arg parsing contract (IMP-U1 S8)", () => {
  it("parses allowed --key=value flags", () => {
    const flags = parseFlags(["--org-id=abc", "--actor-id=op"], ["org-id", "actor-id"]);
    expect(flags.get("org-id")).toBe("abc");
    expect(flags.get("actor-id")).toBe("op");
  });

  it("rejects unknown flags", () => {
    expect(() => parseFlags(["--mystery=1"], ["org-id"])).toThrowError(/unknown flag --mystery/);
  });

  it("preserves subcommand allowlists", () => {
    expect(HANDLERS.status.allowed).toEqual(["org-id"]);
    expect(HANDLERS.cycle.allowed).toContain("fixture-path");
    expect(HANDLERS.confirm.allowed).toContain("ack");
    expect(HANDLERS.request.allowed).toEqual(["org-id", "actor-id", "cap"]);
  });

  it("rejects positional and malformed arguments", () => {
    expect(() => parseFlags(["positional"], ["org-id"])).toThrowError(/unexpected positional/);
    expect(() => parseFlags(["--flag"], ["flag"])).toThrowError(/--key=value/);
  });
});
