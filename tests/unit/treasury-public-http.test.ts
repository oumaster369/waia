import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { handlePublicTreasuryGet } from "@/lib/waia-core/treasury/public/http";
import {
  NOW,
  ORG_A,
  createPublishedPublicTreasuryFacts,
} from "@/tests/unit/helpers/treasury-public";

const postgresRuntime: Extract<WaiaRuntimeDb, { kind: "postgres" }> = {
  kind: "postgres",
  db: {} as Extract<WaiaRuntimeDb, { kind: "postgres" }>["db"],
};

describe("DEE-617 public Treasury HTTP boundary", () => {
  it("fails before database access when the explicit public organization binding is absent", async () => {
    const getRuntimeDb = vi.fn();
    const disposeRuntimeDb = vi.fn().mockResolvedValue(undefined);
    const result = await handlePublicTreasuryGet({
      env: {},
      getRuntimeDb,
      disposeRuntimeDb,
    });

    expect(result).toMatchObject({
      status: 503,
      outcome: "config_error",
      body: {
        error: {
          code: "PUBLIC_TREASURY_ORGANIZATION_NOT_CONFIGURED",
          message: "Public Treasury data is not configured.",
        },
      },
    });
    expect(getRuntimeDb).not.toHaveBeenCalled();
    expect(disposeRuntimeDb).toHaveBeenCalledWith(undefined);
  });

  it("rejects SQLite and never opens a public-finance fallback", async () => {
    const openFacts = vi.fn();
    const sqliteRuntime = {
      kind: "sqlite" as const,
      db: {} as Extract<WaiaRuntimeDb, { kind: "sqlite" }>["db"],
    };
    const result = await handlePublicTreasuryGet({
      env: { WAIA_PUBLIC_TREASURY_ORGANIZATION_ID: ORG_A },
      getRuntimeDb: vi.fn().mockResolvedValue(sqliteRuntime),
      disposeRuntimeDb: vi.fn().mockResolvedValue(undefined),
      openFacts,
    });

    expect(result).toMatchObject({
      status: 503,
      outcome: "config_error",
      waiaDbBackend: "sqlite",
      body: { error: { code: "TREASURY_BACKEND_UNAVAILABLE" } },
    });
    expect(openFacts).not.toHaveBeenCalled();
  });

  it("binds the configured organization server-side, returns no organization selector and disposes runtime", async () => {
    const facts = await createPublishedPublicTreasuryFacts();
    const loadFacts = vi.fn().mockResolvedValue(facts);
    const disposeRuntimeDb = vi.fn().mockResolvedValue("ok");
    const result = await handlePublicTreasuryGet({
      env: { WAIA_PUBLIC_TREASURY_ORGANIZATION_ID: `  ${ORG_A.toUpperCase()}  ` },
      getRuntimeDb: vi.fn().mockResolvedValue(postgresRuntime),
      disposeRuntimeDb,
      openFacts: () => ({ loadFacts }),
      now: () => NOW,
    });

    expect(result.status).toBe(200);
    expect(result.outcome).toBe("success");
    expect(result.pgCloseOutcome).toBe("ok");
    expect(loadFacts).toHaveBeenCalledWith({ organizationId: ORG_A });
    expect(disposeRuntimeDb).toHaveBeenCalledWith(postgresRuntime);
    const json = JSON.stringify(result.body);
    expect(json).not.toContain(ORG_A);
    expect(json).not.toContain("organizationId");
    expect(json).not.toContain("organization_id");
  });

  it("returns a generic fail-closed envelope and still disposes Postgres on read failure", async () => {
    const disposeRuntimeDb = vi.fn().mockResolvedValue("error");
    const result = await handlePublicTreasuryGet({
      env: { WAIA_PUBLIC_TREASURY_ORGANIZATION_ID: ORG_A },
      getRuntimeDb: vi.fn().mockResolvedValue(postgresRuntime),
      disposeRuntimeDb,
      openFacts: () => ({
        async loadFacts() {
          throw new Error("PRIVATE database detail");
        },
      }),
    });

    expect(result).toMatchObject({
      status: 503,
      outcome: "internal_error",
      body: {
        error: {
          code: "PUBLIC_TREASURY_UNAVAILABLE",
          message: "Public Treasury data is temporarily unavailable.",
        },
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("PRIVATE database detail");
    expect(disposeRuntimeDb).toHaveBeenCalledWith(postgresRuntime);
  });

  it("keeps the production boundary GET-only, unpaginated, read-only and org-scoped", () => {
    const root = process.cwd();
    const route = readFileSync(path.join(root, "app/api/public/treasury/route.ts"), "utf8");
    const repository = readFileSync(
      path.join(root, "lib/waia-core/treasury/public/postgres-repository.ts"),
      "utf8",
    );
    const publicDir = [
      "binding.ts",
      "http.ts",
      "postgres-repository.ts",
      "projection.ts",
      "repository.types.ts",
      "types.ts",
    ]
      .map((file) =>
        readFileSync(path.join(root, "lib/waia-core/treasury/public", file), "utf8"),
      )
      .join("\n");

    expect(route).toContain("export async function GET()");
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    expect(route).not.toContain("request.url");
    expect(route).not.toContain("organization_id");
    expect(publicDir).not.toContain("authorizeAdminRoute");
    expect(publicDir).not.toContain("admin.treasury");
    expect(repository).toContain("orgScopedWhere");
    expect(repository).not.toMatch(/\.limit\s*\(/);
    expect(repository).not.toMatch(/\.insert\s*\(/);
    expect(repository).not.toMatch(/\.update\s*\(/);
    expect(repository).not.toMatch(/\.delete\s*\(/);
    expect(repository).not.toContain("treasuryCounterparties");
    expect(repository).not.toContain("treasuryAccounts");
  });
});
