import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";

import { resetWaiaSqliteSingleton } from "@/db/client";
import { resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import * as waiaRuntimeDb from "@/db/waia-runtime-db";
import { buildLiveCliPostgresDeps } from "@/lib/trader/live/build-live-cli-deps";
import * as liveConnector from "@/lib/trader/live/live-connector";

const ORG0 = "00000000-0000-4000-8000-0000000212e";

describe("buildLiveCliPostgresDeps (IMP-U1 S6 / S8)", () => {
  const saved = {
    WAIA_DB_BACKEND: process.env.WAIA_DB_BACKEND,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_POSTGRES: process.env.DATABASE_URL_POSTGRES,
    WAIA_TRADER_ORG0_ORGANIZATION_ID: process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID,
  };

  afterEach(async () => {
    if (saved.WAIA_DB_BACKEND === undefined) {
      delete process.env.WAIA_DB_BACKEND;
    } else {
      process.env.WAIA_DB_BACKEND = saved.WAIA_DB_BACKEND;
    }
    if (saved.DATABASE_URL === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = saved.DATABASE_URL;
    }
    if (saved.DATABASE_URL_POSTGRES === undefined) {
      delete process.env.DATABASE_URL_POSTGRES;
    } else {
      process.env.DATABASE_URL_POSTGRES = saved.DATABASE_URL_POSTGRES;
    }
    if (saved.WAIA_TRADER_ORG0_ORGANIZATION_ID === undefined) {
      delete process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID;
    } else {
      process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = saved.WAIA_TRADER_ORG0_ORGANIZATION_ID;
    }
    resetWaiaSqliteSingleton();
    await resetPostgresSingletonForTests();
    vi.restoreAllMocks();
  });

  it("fail-closed when runtime resolves to sqlite", async () => {
    process.env.WAIA_DB_BACKEND = "sqlite";
    process.env.DATABASE_URL = ":memory:";

    await expect(
      buildLiveCliPostgresDeps({
        organizationId: ORG0,
        credentialId: "cred-test",
      }),
    ).rejects.toThrow(/requires WAIA_DB_BACKEND=postgres/);
  });

  it("returns deps and dispose invokes disposeWaiaRuntimeDb", async () => {
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://127.0.0.1:54329/waia_validate";
    process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = ORG0;

    vi.spyOn(liveConnector, "createLiveHtxConnector").mockResolvedValue({} as never);
    vi.spyOn(liveConnector, "createLiveConnectorForMode").mockReturnValue({} as never);

    const mockPg = drizzle.mock({ schema: pgSchema });
    const runtime = {
      kind: "postgres" as const,
      db: mockPg,
      _sql: { end: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Extract<WaiaRuntimeDb, { kind: "postgres" }>;
    vi.spyOn(waiaRuntimeDb, "getWaiaRuntimeDb").mockResolvedValue(runtime);
    const disposeSpy = vi.spyOn(waiaRuntimeDb, "disposeWaiaRuntimeDb").mockResolvedValue(undefined);

    const built = await buildLiveCliPostgresDeps({
      organizationId: ORG0,
      credentialId: "cred-test",
      createProvider: () =>
        ({
          encrypt: vi.fn(),
          decrypt: vi.fn(),
        }) as never,
    });

    expect(built.deps.execution).toBeDefined();
    expect(built.deps.orderRepository).toBeDefined();
    expect(built.orgLiveEnableService).toBeDefined();

    await built.dispose();
    expect(disposeSpy).toHaveBeenCalledWith(runtime);
  });
});
