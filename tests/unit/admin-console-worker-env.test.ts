import { afterEach, describe, expect, it, vi } from "vitest";

const cloudflareContext = vi.hoisted(() => vi.fn());
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: cloudflareContext }));

import {
  bridgeRequestDatabaseEnv,
  bridgeTraderCronEnvToProcess,
  rememberWorkerEnv,
} from "@/lib/trader/cron/worker-cron-env";
import { getResolvedWaiaDbRuntimeConfig } from "@/db/runtime-backend";

afterEach(() => {
  vi.unstubAllEnvs();
  rememberWorkerEnv({});
  cloudflareContext.mockReset();
});

describe("Worker admin database configuration", () => {
  it("uses database bindings before selecting the request runtime", async () => {
    vi.stubEnv("WAIA_DB_BACKEND", "");
    vi.stubEnv("DATABASE_URL_POSTGRES", "");
    cloudflareContext.mockResolvedValue({
      env: {
        WAIA_DB_BACKEND: "postgres",
        DATABASE_URL_POSTGRES: "postgres://fixture/worker",
      },
    });
    await bridgeRequestDatabaseEnv();
    expect(getResolvedWaiaDbRuntimeConfig()).toEqual({
      backend: "postgres",
      databaseUrlPostgres: "postgres://fixture/worker",
    });
  });

  it("preserves an explicitly configured local test database", async () => {
    vi.stubEnv("WAIA_DB_BACKEND", "postgres");
    vi.stubEnv("DATABASE_URL_POSTGRES", "postgres://fixture/local");
    await bridgeRequestDatabaseEnv();
    expect(cloudflareContext).not.toHaveBeenCalled();
    expect(getResolvedWaiaDbRuntimeConfig()).toEqual({
      backend: "postgres",
      databaseUrlPostgres: "postgres://fixture/local",
    });
  });

  it("uses the explicit scheduled binding and ignores absent bindings", () => {
    vi.stubEnv("WAIA_DB_BACKEND", "sqlite");
    vi.stubEnv("DATABASE_URL_POSTGRES", "postgres://fixture/old");
    bridgeTraderCronEnvToProcess({
      WAIA_DB_BACKEND: "postgres",
      DATABASE_URL_POSTGRES: "postgres://fixture/scheduled",
    });
    bridgeTraderCronEnvToProcess({});
    expect(getResolvedWaiaDbRuntimeConfig()).toEqual({
      backend: "postgres",
      databaseUrlPostgres: "postgres://fixture/scheduled",
    });
  });
});
