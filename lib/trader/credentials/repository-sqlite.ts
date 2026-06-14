import "server-only";

import { and, eq } from "drizzle-orm";

import { exchangeCredentials } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import type {
  ExchangeCredentialRow,
  InsertExchangeCredentialRowInput,
} from "@/lib/trader/credentials/types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

function mapRow(row: typeof exchangeCredentials.$inferSelect): ExchangeCredentialRow {
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

export function insertCredentialRowSqlite(
  db: WaiaDb,
  context: OrgContext,
  input: InsertExchangeCredentialRowInput,
): ExchangeCredentialRow {
  const scoped = requireOrgContext(context.organizationId);
  const id = crypto.randomUUID();
  const now = new Date();

  db.insert(exchangeCredentials)
    .values({
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
    })
    .run();

  const row = getCredentialRowByIdSqlite(db, scoped, id);
  if (!row) {
    throw new Error("[trader] exchange credential insert failed");
  }
  return row;
}

export function getCredentialRowByIdSqlite(
  db: WaiaDb,
  context: OrgContext,
  credentialId: string,
): ExchangeCredentialRow | null {
  const scoped = requireOrgContext(context.organizationId);
  const row = db
    .select()
    .from(exchangeCredentials)
    .where(
      and(
        eq(exchangeCredentials.id, credentialId),
        orgScopedWhere(exchangeCredentials.organizationId, scoped),
      ),
    )
    .limit(1)
    .all()[0];

  return row ? mapRow(row) : null;
}

export function listCredentialRowsForOrgSqlite(
  db: WaiaDb,
  context: OrgContext,
): ExchangeCredentialRow[] {
  const scoped = requireOrgContext(context.organizationId);
  return db
    .select()
    .from(exchangeCredentials)
    .where(orgScopedWhere(exchangeCredentials.organizationId, scoped))
    .all()
    .map(mapRow);
}

export function revokeCredentialRowSqlite(
  db: WaiaDb,
  context: OrgContext,
  credentialId: string,
): ExchangeCredentialRow | null {
  const scoped = requireOrgContext(context.organizationId);
  const existing = getCredentialRowByIdSqlite(db, scoped, credentialId);
  if (!existing || existing.status === "revoked") {
    return null;
  }

  const now = new Date();
  db.update(exchangeCredentials)
    .set({
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(exchangeCredentials.id, credentialId),
        orgScopedWhere(exchangeCredentials.organizationId, scoped),
      ),
    )
    .run();

  return getCredentialRowByIdSqlite(db, scoped, credentialId);
}
