import "server-only";

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type {
  ExchangeCredentialRow,
  InsertExchangeCredentialRowInput,
} from "@/lib/trader/credentials/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function mapRow(row: typeof pgSchema.exchangeCredentials.$inferSelect): ExchangeCredentialRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    apiKeyMasked: row.apiKeyMasked,
    encryptedPayload: row.encryptedPayload,
    payloadKeyVersion: row.payloadKeyVersion,
    wrappedDekKeyVersion: row.wrappedDekKeyVersion,
    wrappedDekKey: row.wrappedDekKey,
    permissionMetadata: row.permissionMetadata,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
  };
}

export async function insertCredentialRowPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  input: InsertExchangeCredentialRowInput,
): Promise<ExchangeCredentialRow> {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  await ex.insert(pgSchema.exchangeCredentials).values({
    id,
    organizationId: scoped.organizationId,
    venue: input.venue,
    exchangeAccountId: input.exchangeAccountId,
    apiKeyMasked: input.apiKeyMasked ?? null,
    encryptedPayload: input.encryptedPayload ?? null,
    payloadKeyVersion: input.payloadKeyVersion ?? null,
    wrappedDekKeyVersion: input.wrappedDekKeyVersion ?? null,
    wrappedDekKey: input.wrappedDekKey ?? null,
    permissionMetadata: input.permissionMetadata ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  });

  const row = await getCredentialRowByIdPostgres(ex, scoped, id);
  if (!row) {
    throw new Error("[trader] exchange credential insert failed");
  }
  return row;
}

export async function getCredentialRowByIdPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  credentialId: string,
): Promise<ExchangeCredentialRow | null> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.exchangeCredentials)
    .where(
      and(
        eq(pgSchema.exchangeCredentials.id, credentialId),
        orgScopedWhere(pgSchema.exchangeCredentials.organizationId, scoped),
      ),
    )
    .limit(1);

  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listCredentialRowsForOrgPostgres(
  ex: PgReadExecutor,
  context: OrgContext,
): Promise<ExchangeCredentialRow[]> {
  const scoped = requireOrgContext(context.organizationId);
  const rows = await ex
    .select()
    .from(pgSchema.exchangeCredentials)
    .where(orgScopedWhere(pgSchema.exchangeCredentials.organizationId, scoped));

  return rows.map(mapRow);
}

export async function revokeCredentialRowPostgres(
  ex: PgWriteExecutor,
  context: OrgContext,
  credentialId: string,
): Promise<ExchangeCredentialRow | null> {
  const scoped = requireOrgContext(context.organizationId);
  const now = new Date();
  const rows = await ex
    .update(pgSchema.exchangeCredentials)
    .set({
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(pgSchema.exchangeCredentials.id, credentialId),
        eq(pgSchema.exchangeCredentials.status, "active"),
        orgScopedWhere(pgSchema.exchangeCredentials.organizationId, scoped),
      ),
    )
    .returning();

  return rows[0] ? mapRow(rows[0]) : null;
}
