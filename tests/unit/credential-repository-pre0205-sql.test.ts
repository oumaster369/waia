// @vitest-environment node
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  getCredentialRowByIdPostgres,
  insertCredentialRowPostgres,
  listCredentialRowsForOrgPostgres,
  revokeCredentialRowPostgres,
} from "@/lib/trader/credentials/repository-postgres";

const context = { organizationId: "00000000-0000-4000-8000-000000000001" };
const credentialId = "00000000-0000-4000-8000-000000000002";
const legacyColumns = [
  "id", "organization_id", "venue", "exchange_account_id", "api_key_masked",
  "encrypted_payload", "payload_key_version", "wrapped_dek_key_version", "wrapped_dek_key",
  "permission_metadata", "status", "created_at", "updated_at", "revoked_at",
];

function captureRepositorySql() {
  const queries: { sql: string; params: unknown[] }[] = [];
  // Exercise the real repository and Drizzle PostgreSQL builders without a DB,
  // network, environment configuration or credentials. Empty results are intentional.
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [] };
  }, { schema });
  return { db: db as unknown as WaiaPostgresDb, queries };
}

function expectLegacyProjection(sql: string) {
  expect(sql).not.toContain("observation_revision");
  for (const column of legacyColumns) expect(sql).toContain(`"${column}"`);
}

describe("legacy credential SQL remains compatible before optional migration 0205", () => {
  it("gets a credential without selecting the not-yet-installed observation fence", async () => {
    const { db, queries } = captureRepositorySql();
    expect(await getCredentialRowByIdPostgres(db, context, credentialId)).toBeNull();
    expect(queries).toHaveLength(1);
    expectLegacyProjection(queries[0].sql);
    expect(queries[0].sql).toMatch(/^select /);
    expect(queries[0].params).toEqual([credentialId, context.organizationId, 1]);
  });

  it("lists credentials with the legacy projection and organization predicate", async () => {
    const { db, queries } = captureRepositorySql();
    expect(await listCredentialRowsForOrgPostgres(db, context)).toEqual([]);
    expect(queries).toHaveLength(1);
    expectLegacyProjection(queries[0].sql);
    expect(queries[0].sql).toMatch(/where "exchange_credentials"\."organization_id" = \$1$/);
    expect(queries[0].params).toEqual([context.organizationId]);
  });

  it("inserts only legacy columns, then performs a compatible scoped read", async () => {
    const { db, queries } = captureRepositorySql();
    // The SQL-only transport returns no inserted row; verify the repository's
    // existing missing-row failure, not a fabricated successful database write.
    await expect(insertCredentialRowPostgres(db, context, {
      venue: "htx", exchangeAccountId: "123",
    })).rejects.toThrow("[trader] exchange credential insert failed");
    expect(queries).toHaveLength(2);
    expect(queries[0].sql).toMatch(/^insert into "exchange_credentials" /);
    expect(queries[1].sql).toMatch(/^select /);
    for (const query of queries) expectLegacyProjection(query.sql);
    expect(queries[0].params).toContain(context.organizationId);
    expect(queries[1].params[1]).toBe(context.organizationId);
  });

  it("revokes only the scoped active credential with a legacy RETURNING projection", async () => {
    const { db, queries } = captureRepositorySql();
    expect(await revokeCredentialRowPostgres(db, context, credentialId)).toBeNull();
    expect(queries).toHaveLength(1);
    expectLegacyProjection(queries[0].sql);
    expect(queries[0].sql).toMatch(/^update "exchange_credentials" set /);
    expect(queries[0].sql).toContain(" returning ");
    expect(queries[0].params.slice(-3)).toEqual([credentialId, "active", context.organizationId]);
  });
});
