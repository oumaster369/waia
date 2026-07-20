import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildCampaignRunFrontmatter,
  resolveCampaignEnvironment,
  resolveDbConnectionMode,
  resolveExecutionOrigin,
} from "@/lib/trader/research/campaign-run-frontmatter";

describe("campaign run frontmatter", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "WAIA_EXECUTION_SURFACE",
      "WAIA_EXECUTION_SERVER",
      "GITHUB_ACTIONS",
      "CURSOR_AGENT",
      "WAIA_ENV",
      "NODE_ENV",
      "WAIA_DB_BACKEND",
      "DATABASE_URL_POSTGRES_SESSION",
      "DATABASE_URL_POSTGRES",
      "GITHUB_SHA",
      "VERCEL_GIT_COMMIT_SHA",
    ]) {
      saved[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("builds all required provenance fields", () => {
    process.env.WAIA_EXECUTION_SURFACE = "execution-server";
    process.env.WAIA_ENV = "org0";
    process.env.GITHUB_SHA = "abc123def456";

    const frontmatter = buildCampaignRunFrontmatter({
      runId: "run-m9-test",
      dbConnectionMode: "session",
    });

    expect(frontmatter).toEqual({
      runId: "run-m9-test",
      executionOrigin: "execution-server",
      gitSha: "abc123def456",
      environment: "org0",
      dbConnectionMode: "session",
    });
  });

  it("generates runId when omitted", () => {
    const frontmatter = buildCampaignRunFrontmatter();
    expect(frontmatter.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("infers execution-server from WAIA_EXECUTION_SERVER", () => {
    delete process.env.WAIA_EXECUTION_SURFACE;
    process.env.WAIA_EXECUTION_SERVER = "1";
    expect(resolveExecutionOrigin()).toBe("execution-server");
  });

  it("infers github-actions on CI", () => {
    delete process.env.WAIA_EXECUTION_SURFACE;
    process.env.GITHUB_ACTIONS = "true";
    expect(resolveExecutionOrigin()).toBe("github-actions");
  });

  it("infers ci environment on GitHub Actions", () => {
    delete process.env.WAIA_ENV;
    process.env.GITHUB_ACTIONS = "true";
    expect(resolveCampaignEnvironment()).toBe("ci");
  });

  it("prefers session db connection mode when session URL is set", () => {
    process.env.DATABASE_URL_POSTGRES_SESSION = "postgresql://session/db";
    process.env.DATABASE_URL_POSTGRES = "postgresql://transaction/db";
    expect(resolveDbConnectionMode()).toBe("session");
  });

  it("returns sqlite when WAIA_DB_BACKEND=sqlite", () => {
    process.env.WAIA_DB_BACKEND = "sqlite";
    delete process.env.DATABASE_URL_POSTGRES;
    delete process.env.DATABASE_URL_POSTGRES_SESSION;
    expect(resolveDbConnectionMode()).toBe("sqlite");
  });
});
