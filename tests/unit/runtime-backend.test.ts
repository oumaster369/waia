import { afterEach, describe, expect, it } from "vitest";

import {
  getResolvedWaiaDbRuntimeConfig,
  getWaiaDbBackend,
} from "@/db/runtime-backend";

describe("runtime-backend (WAIA_DB_BACKEND)", () => {
  const saved = {
    WAIA_DB_BACKEND: process.env.WAIA_DB_BACKEND,
    DATABASE_URL_POSTGRES: process.env.DATABASE_URL_POSTGRES,
  };

  afterEach(() => {
    if (saved.WAIA_DB_BACKEND === undefined) {
      delete process.env.WAIA_DB_BACKEND;
    } else {
      process.env.WAIA_DB_BACKEND = saved.WAIA_DB_BACKEND;
    }
    if (saved.DATABASE_URL_POSTGRES === undefined) {
      delete process.env.DATABASE_URL_POSTGRES;
    } else {
      process.env.DATABASE_URL_POSTGRES = saved.DATABASE_URL_POSTGRES;
    }
  });

  it("defaults to sqlite when WAIA_DB_BACKEND is unset", () => {
    delete process.env.WAIA_DB_BACKEND;
    expect(getResolvedWaiaDbRuntimeConfig()).toEqual({ backend: "sqlite" });
    expect(getWaiaDbBackend()).toBe("sqlite");
  });

  it("defaults to sqlite when WAIA_DB_BACKEND is empty or whitespace", () => {
    process.env.WAIA_DB_BACKEND = "   ";
    expect(getResolvedWaiaDbRuntimeConfig()).toEqual({ backend: "sqlite" });
  });

  it("accepts sqlite explicitly (case-insensitive)", () => {
    process.env.WAIA_DB_BACKEND = "SQLite";
    expect(getResolvedWaiaDbRuntimeConfig()).toEqual({ backend: "sqlite" });
  });

  it("throws on invalid WAIA_DB_BACKEND", () => {
    process.env.WAIA_DB_BACKEND = "mysql";
    expect(() => getResolvedWaiaDbRuntimeConfig()).toThrow(/Invalid WAIA_DB_BACKEND/);
  });

  it("requires DATABASE_URL_POSTGRES when backend is postgres", () => {
    process.env.WAIA_DB_BACKEND = "postgres";
    delete process.env.DATABASE_URL_POSTGRES;
    expect(() => getResolvedWaiaDbRuntimeConfig()).toThrow(
      /WAIA_DB_BACKEND=postgres requires a non-empty DATABASE_URL_POSTGRES/,
    );
  });

  it("rejects empty DATABASE_URL_POSTGRES when backend is postgres", () => {
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "   ";
    expect(() => getResolvedWaiaDbRuntimeConfig()).toThrow(
      /WAIA_DB_BACKEND=postgres requires a non-empty DATABASE_URL_POSTGRES/,
    );
  });

  it("returns postgres config when URL is set", () => {
    process.env.WAIA_DB_BACKEND = "postgres";
    process.env.DATABASE_URL_POSTGRES = "postgresql://localhost:54329/waia_validate";
    expect(getResolvedWaiaDbRuntimeConfig()).toEqual({
      backend: "postgres",
      databaseUrlPostgres: "postgresql://localhost:54329/waia_validate",
    });
    expect(getWaiaDbBackend()).toBe("postgres");
  });
});
