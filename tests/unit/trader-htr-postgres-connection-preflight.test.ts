import { describe, expect, it } from "vitest";

import {
  assertHtrPostgresConnectionEnvironment,
  HTR_LOCAL_VALIDATION_DATABASE_URL,
  verifyHtrPostgresConnectionIdentity,
} from "@/lib/trader/readiness/htr-postgres-connection-preflight";

describe("HTR Postgres connection preflight (HTR-WP22)", () => {
  it("exports local validation URL without exposing password in constant name", () => {
    expect(HTR_LOCAL_VALIDATION_DATABASE_URL).toContain("127.0.0.1:54329/waia_validate");
    expect(HTR_LOCAL_VALIDATION_DATABASE_URL).not.toContain("password");
  });

  it("requires WAIA_PG_INTEGRATION=1", () => {
    const prior = process.env.WAIA_PG_INTEGRATION;
    delete process.env.WAIA_PG_INTEGRATION;
    try {
      expect(() => assertHtrPostgresConnectionEnvironment()).toThrow(
        /HTR_WP22_PG_PREFLIGHT:WAIA_PG_INTEGRATION_REQUIRED/,
      );
    } finally {
      if (prior === undefined) {
        delete process.env.WAIA_PG_INTEGRATION;
      } else {
        process.env.WAIA_PG_INTEGRATION = prior;
      }
    }
  });

  it("rejects non-local host", () => {
    const priorUrl = process.env.DATABASE_URL_POSTGRES;
    const priorIntegration = process.env.WAIA_PG_INTEGRATION;
    const priorBackend = process.env.WAIA_DB_BACKEND;
    process.env.WAIA_PG_INTEGRATION = "1";
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES =
      "postgresql://waia_validate:secret@db.example.com:54329/waia_validate";
    try {
      expect(() => assertHtrPostgresConnectionEnvironment()).toThrow(
        /HTR_WP22_PG_PREFLIGHT:NON_LOCAL_HOST/,
      );
    } finally {
      if (priorUrl === undefined) {
        delete process.env.DATABASE_URL_POSTGRES;
      } else {
        process.env.DATABASE_URL_POSTGRES = priorUrl;
      }
      if (priorIntegration === undefined) {
        delete process.env.WAIA_PG_INTEGRATION;
      } else {
        process.env.WAIA_PG_INTEGRATION = priorIntegration;
      }
      if (priorBackend === undefined) {
        delete process.env.WAIA_DB_BACKEND;
      } else {
        process.env.WAIA_DB_BACKEND = priorBackend;
      }
    }
  });

  it("accepts exact local validation profile when env is configured", async () => {
    const priorUrl = process.env.DATABASE_URL_POSTGRES;
    const priorIntegration = process.env.WAIA_PG_INTEGRATION;
    const priorBackend = process.env.WAIA_DB_BACKEND;
    process.env.WAIA_PG_INTEGRATION = "1";
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = HTR_LOCAL_VALIDATION_DATABASE_URL;

    try {
      const env = assertHtrPostgresConnectionEnvironment();
      expect(env.host).toBe("127.0.0.1");
      expect(env.port).toBe(54329);
      expect(env.database).toBe("waia_validate");
      expect(env.role).toBe("waia_validate");

      if (process.env.WAIA_PG_INTEGRATION === "1" && priorIntegration === "1") {
        await expect(verifyHtrPostgresConnectionIdentity()).resolves.toMatchObject({
          role: "waia_validate",
          database: "waia_validate",
        });
      }
    } finally {
      if (priorUrl === undefined) {
        delete process.env.DATABASE_URL_POSTGRES;
      } else {
        process.env.DATABASE_URL_POSTGRES = priorUrl;
      }
      if (priorIntegration === undefined) {
        delete process.env.WAIA_PG_INTEGRATION;
      } else {
        process.env.WAIA_PG_INTEGRATION = priorIntegration;
      }
      if (priorBackend === undefined) {
        delete process.env.WAIA_DB_BACKEND;
      } else {
        process.env.WAIA_DB_BACKEND = priorBackend;
      }
    }
  });
});
