import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from "@/lib/trader/credentials/envelope-crypto";
import { CredentialNotFoundError } from "@/lib/trader/credentials/errors";
import { maskApiKey } from "@/lib/trader/credentials/masking";
import {
  createPostgresExchangeCredentialRepository,
  createSqliteExchangeCredentialRepository,
} from "@/lib/trader/credentials/repository-adapters";
import type {
  CredentialMetadata,
  CredentialService,
  CredentialServiceDeps,
  ExchangeCredentialRow,
  RevokeCredentialsInput,
  StoreCredentialsInput,
} from "@/lib/trader/credentials/types";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { assertCredentialStorageAllowed } from "@/lib/trader/security/credential-storage-gate";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgCredentialExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function parsePermissionMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function serializePermissionMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) {
    return null;
  }
  return JSON.stringify(metadata);
}

function toCredentialMetadata(row: ExchangeCredentialRow): CredentialMetadata {
  return {
    id: row.id,
    venue: row.venue,
    exchangeAccountId: row.exchangeAccountId,
    apiKeyMasked: row.apiKeyMasked,
    status: row.status,
    permissionMetadata: parsePermissionMetadata(row.permissionMetadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revokedAt: row.revokedAt,
  };
}

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: CredentialServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

async function findActiveCredential(
  repository: CredentialServiceDeps["repository"],
  context: OrgContext,
  venue: string,
  exchangeAccountId: string,
): Promise<ExchangeCredentialRow | null> {
  const rows = await repository.listCredentialRowsForOrg(context);
  return (
    rows.find(
      (row) =>
        row.status === "active" &&
        row.venue === venue &&
        row.exchangeAccountId === exchangeAccountId,
    ) ?? null
  );
}

function buildAuditInput(
  context: OrgContext,
  action: TraderAuditInput["action"],
  entityId: string,
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action,
    entityType: traderEntityTypes.exchangeCredential,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

export function createCredentialService(deps: CredentialServiceDeps): CredentialService {
  const createProvider = deps.createProvider ?? createMasterKeyProvider;

  return {
    async storeCredentials(context, input: StoreCredentialsInput): Promise<CredentialMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const provider = await createProvider();
      assertCredentialStorageAllowed(provider);

      const encrypted = await encryptCredentialPayload(provider, input.credentials);
      const existing = await findActiveCredential(
        deps.repository,
        scoped,
        input.venue,
        input.exchangeAccountId,
      );

      if (existing) {
        await deps.repository.revokeCredentialRow(scoped, existing.id);
      }

      const row = await deps.repository.insertCredentialRow(scoped, {
        venue: input.venue,
        exchangeAccountId: input.exchangeAccountId,
        apiKeyMasked: maskApiKey(input.credentials.apiKey),
        encryptedPayload: encrypted.encryptedPayload,
        payloadKeyVersion: encrypted.payloadKeyVersion,
        wrappedDekKeyVersion: encrypted.wrappedDekKeyVersion,
        wrappedDekKey: encrypted.wrappedDekKey,
        permissionMetadata: serializePermissionMetadata(input.permissionMetadata),
      });

      const actorType = input.actorType ?? "service";
      const actorId = input.actorId ?? null;
      await deps.writeAudit(
        buildAuditInput(
          scoped,
          existing ? traderAuditActions.credentialRotated : traderAuditActions.credentialCreated,
          row.id,
          {
            venue: input.venue,
            exchangeAccountId: input.exchangeAccountId,
            ...(existing ? { replacedCredentialId: existing.id } : {}),
          },
          actorType,
          actorId,
        ),
      );

      return toCredentialMetadata(row);
    },

    async getDecryptedCredentials(
      context: OrgContext,
      credentialId: string,
    ): Promise<ConnectorCredentialInput> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const row = await deps.repository.getCredentialRowById(scoped, credentialId);
      if (!row || row.status !== "active") {
        throw new CredentialNotFoundError();
      }

      const provider = await createProvider();
      return decryptCredentialPayload(provider, row);
    },

    async revokeCredentials(
      context: OrgContext,
      credentialId: string,
      input: RevokeCredentialsInput = {},
    ): Promise<CredentialMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const row = await deps.repository.revokeCredentialRow(scoped, credentialId);
      if (!row) {
        throw new CredentialNotFoundError();
      }

      const actorType = input.actorType ?? "service";
      const actorId = input.actorId ?? null;
      await deps.writeAudit(
        buildAuditInput(
          scoped,
          traderAuditActions.credentialRevoked,
          row.id,
          { venue: row.venue, exchangeAccountId: row.exchangeAccountId },
          actorType,
          actorId,
        ),
      );

      return toCredentialMetadata(row);
    },

    async listCredentialMetadata(context: OrgContext): Promise<CredentialMetadata[]> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const rows = await deps.repository.listCredentialRowsForOrg(scoped);
      return rows.map(toCredentialMetadata);
    },
  };
}

export function createSqliteCredentialService(
  db: WaiaDb,
  deps: Partial<CredentialServiceDeps> = {},
): CredentialService {
  return createCredentialService({
    repository: deps.repository ?? createSqliteExchangeCredentialRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    createProvider: deps.createProvider,
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresCredentialService(
  ex: PgCredentialExecutor,
  deps: Partial<CredentialServiceDeps> = {},
): CredentialService {
  return createCredentialService({
    repository: deps.repository ?? createPostgresExchangeCredentialRepository(ex),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    createProvider: deps.createProvider,
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
