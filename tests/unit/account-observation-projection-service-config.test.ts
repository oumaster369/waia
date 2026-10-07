// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseProjectionDatabaseCredentials, parseProjectionServiceConfig } from "@/lib/trader/account-observation/projection-service-config";

const input = () => ({ version: 1, deployment: "production", tuple: {
  audience: "https://observation-reader.waia.life", releaseSha: "a".repeat(40),
  epochId: "00000000-0000-4000-8000-000000000001", keyId: "release-fixture" },
  databaseHost: "db.wdsnuvldxyrkqcjxvuxp.supabase.co", databasePort: 5432, databaseName: "postgres" });
const uri = "postgres://waia_account_observation_reader_login:synthetic-only@db.wdsnuvldxyrkqcjxvuxp.supabase.co:5432/postgres";

describe("projection-only startup configuration", () => {
  it("detaches/freezes exact endpoint/release identity and strips URL options from credentials", () => {
    const source = input(); const config = parseProjectionServiceConfig(source);
    source.tuple.releaseSha = "b".repeat(40);
    expect(config.tuple.releaseSha).toBe("a".repeat(40));
    expect(Object.isFrozen(config.tuple)).toBe(true);
    expect(parseProjectionDatabaseCredentials(uri, config)).toEqual({
      host: config.databaseHost, port: 5432, database: "postgres",
      username: "waia_account_observation_reader_login", password: "synthetic-only" });
  });
  it.each(["?sslmode=disable", "?max=50", "#fragment"])("rejects a driver override %s", suffix => {
    expect(() => parseProjectionDatabaseCredentials(uri + suffix, parseProjectionServiceConfig(input()))).toThrow();
  });
  it.each([
    uri.replace("reader_login", "credential_login"),
    uri.replace("wdsnuvldxyrkqcjxvuxp", "another-project"),
    uri.replace(":5432", ":6543"), uri.replace("/postgres", "/other"),
    uri.replace(":synthetic-only", ""),
  ])("rejects a substituted DB identity without exposing input", wrong => {
    expect(() => parseProjectionDatabaseCredentials(wrong, parseProjectionServiceConfig(input())))
      .toThrowError("PROJECTION_SERVICE_CONFIG_REFUSED");
  });
  it("permits only the explicit synthetic test endpoint/database in isolated-test configuration", () => {
    const config = parseProjectionServiceConfig({ ...input(), deployment: "isolated-test",
      databaseHost: "waia-projection-test-db", databaseName: "waia_projection_test" });
    expect(config.deployment).toBe("isolated-test");
    expect(() => parseProjectionServiceConfig({ ...input(), deployment: "isolated-test" })).toThrow();
    expect(() => parseProjectionServiceConfig({ ...config, databaseHost: "example.com" })).toThrow();
    expect(() => parseProjectionServiceConfig({ ...config, deployment: "production" })).toThrow();
  });
  it("rejects extra capability/config fields and malformed audience/epoch/release", () => {
    expect(() => parseProjectionServiceConfig({ ...input(), max: 5 })).toThrow();
    for (const tuple of [{ audience: "https://other.invalid" }, { epochId: "arbitrary" }, { releaseSha: "latest" }]) {
      expect(() => parseProjectionServiceConfig({ ...input(), tuple: { ...input().tuple, ...tuple } })).toThrow();
    }
  });
});
