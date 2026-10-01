import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";

describe("research durable root transaction boundary", () => {
  it("accepts the real root adapter without querying a database", async () => {
    // Creating postgres.js/Drizzle handles is lazy; this test opens no socket.
    const client = postgres("postgresql://unused:unused@127.0.0.1:1/unused", { max: 1 });
    try {
      expect(() => assertResearchRootPostgresDbV1(drizzle(client))).not.toThrow();
    } finally {
      await client.end();
    }
  });

  it.each([null, undefined, {}, { transaction: true }, { constructor: { name: "PostgresJsDatabase" } }]
    .map(value => [value] as [unknown]))(
    "refuses a structural or serialized substitute: %j", value => {
      expect(() => assertResearchRootPostgresDbV1(value)).toThrow("RESEARCH_ROOT_DATABASE_REQUIRED");
    },
  );

  it("does not invoke a caller-supplied transaction implementation", () => {
    const transaction = vi.fn();
    expect(() => assertResearchRootPostgresDbV1({ transaction })).toThrow("RESEARCH_ROOT_DATABASE_REQUIRED");
    expect(transaction).not.toHaveBeenCalled();
  });
});
