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
import {
  CredentialConflictError,
  CredentialNotFoundError,
} from "@/lib/trader/credentials/errors";
import { maskApiKey } from "@/lib/trader/credentials/masking";
import {
  createPostgresExchangeCredentialRepository,
  createSqliteExchangeCredentialRepository,
} from "@/lib/trader/credentials/repository-adapters";
import {
  getCredentialRowByIdSqlite,
  insertCredentialRowSqlite,
  listCredentialRowsForOrgSqlite,
  revokeCredentialRowSqlite,
} from "@/lib/trader/credentials/repository-sqlite";
import type {
  CredentialMetadata,
  CredentialService,
  CredentialServiceDeps,
  ExchangeCredentialRow,
  RevokeCredentialsInput,
  StoreCredentialsInput,
} from "@/lib/trader/credentials/types";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import {
  assertCredentialDecryptionAllowed,
  assertCredentialStorageAllowed,
} from "@/lib/trader/security/credential-storage-gate";
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

      if (
        input.expectedActiveCredentialId !== undefined &&
        (existing?.id ?? null) !== input.expectedActiveCredentialId
      ) {
        throw new CredentialConflictError();
      }

      if (existing) {
        const revoked = await deps.repository.revokeCredentialRow(scoped, existing.id);
        if (!revoked) {
          throw new CredentialConflictError();
        }
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

      const provider = await createProvider();
      assertCredentialDecryptionAllowed(provider);

      const row = await deps.repository.getCredentialRowById(scoped, credentialId);
      if (!row || row.status !== "active") {
        throw new CredentialNotFoundError();
      }

      return decryptCredentialPayload(provider, row);
    },

    async revokeCredentials(
      context: OrgContext,
      credentialId: string,
      input: RevokeCredentialsInput = {},
    ): Promise<CredentialMetadata> {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const existing = await deps.repository.getCredentialRowById(scoped, credentialId);
      if (!existing) {
        throw new CredentialNotFoundError();
      }

      if (existing.status === "revoked") {
        return toCredentialMetadata(existing);
      }

      const row = await deps.repository.revokeCredentialRow(scoped, credentialId);
      if (!row) {
        const raced = await deps.repository.getCredentialRowById(scoped, credentialId);
        if (raced?.status === "revoked") {
          return toCredentialMetadata(raced);
        }
        throw new CredentialConflictError();
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
  if (deps.repository) {
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

  const createProvider = deps.createProvider ?? createMasterKeyProvider;
  const assertMembership = deps.assertMembership ?? ((context) => assertOrgMembershipSqlite(db, context));
  const writeAudit = deps.writeAudit ?? ((input: TraderAuditInput) => writeTraderAuditLogSqlite(db, input));
  const writeAuditInTransaction = (tx: WaiaDb, input: TraderAuditInput): void => {
    const result = deps.writeAudit
      ? deps.writeAudit(input)
      : writeTraderAuditLogSqlite(tx, input);
    if (result instanceof Promise) {
      throw new Error("[trader] SQLite credential audit writer must be synchronous");
    }
  };
  const base = createCredentialService({
    repository: createSqliteExchangeCredentialRepository(db),
    writeAudit,
    createProvider,
    assertMembership,
  });

  return {
    ...base,
    async storeCredentials(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, assertMembership);
      const provider = await createProvider();
      assertCredentialStorageAllowed(provider);
      const encrypted = await encryptCredentialPayload(provider, input.credentials);

      return db.transaction((tx) => {
        const sqlite = tx as WaiaDb;
        const existing = listCredentialRowsForOrgSqlite(sqlite, scoped)
          .find(
            (row) =>
              row.status === "active" &&
              row.venue === input.venue &&
              row.exchangeAccountId === input.exchangeAccountId,
          ) ?? null;
        if (
          input.expectedActiveCredentialId !== undefined &&
          (existing?.id ?? null) !== input.expectedActiveCredentialId
        ) {
          throw new CredentialConflictError();
        }
        if (existing && !revokeCredentialRowSqlite(sqlite, scoped, existing.id)) {
          throw new CredentialConflictError();
        }
        const row = insertCredentialRowSqlite(sqlite, scoped, {
          venue: input.venue,
          exchangeAccountId: input.exchangeAccountId,
          apiKeyMasked: maskApiKey(input.credentials.apiKey),
          encryptedPayload: encrypted.encryptedPayload,
          payloadKeyVersion: encrypted.payloadKeyVersion,
          wrappedDekKeyVersion: encrypted.wrappedDekKeyVersion,
          wrappedDekKey: encrypted.wrappedDekKey,
          permissionMetadata: serializePermissionMetadata(input.permissionMetadata),
        });
        writeAuditInTransaction(
          tx as WaiaDb,
          buildAuditInput(
            scoped,
            existing ? traderAuditActions.credentialRotated : traderAuditActions.credentialCreated,
            row.id,
            {
              venue: input.venue,
              exchangeAccountId: input.exchangeAccountId,
              ...(existing ? { replacedCredentialId: existing.id } : {}),
            },
            input.actorType ?? "service",
            input.actorId ?? null,
          ),
        );
        return toCredentialMetadata(row);
      });
    },
    async revokeCredentials(context, credentialId, input = {}) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, assertMembership);
      return db.transaction((tx) => {
        const sqlite = tx as WaiaDb;
        const existing = getCredentialRowByIdSqlite(sqlite, scoped, credentialId);
        if (!existing) throw new CredentialNotFoundError();
        if (existing.status === "revoked") return toCredentialMetadata(existing);
        const row = revokeCredentialRowSqlite(sqlite, scoped, credentialId);
        if (!row) {
          const raced = getCredentialRowByIdSqlite(sqlite, scoped, credentialId);
          if (raced?.status === "revoked") return toCredentialMetadata(raced);
          throw new CredentialConflictError();
        }
        writeAuditInTransaction(
          tx as WaiaDb,
          buildAuditInput(
            scoped,
            traderAuditActions.credentialRevoked,
            row.id,
            { venue: row.venue, exchangeAccountId: row.exchangeAccountId },
            input.actorType ?? "service",
            input.actorId ?? null,
          ),
        );
        return toCredentialMetadata(row);
      });
    },
  };
}

export function createPostgresCredentialService(
  ex: WaiaPostgresDb,
  deps: Partial<CredentialServiceDeps> = {},
): CredentialService {
  if (deps.repository) {
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
  const serviceFor = (executor: PgCredentialExecutor) => createCredentialService({
    repository: createPostgresExchangeCredentialRepository(executor),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(executor, input)),
    createProvider: deps.createProvider,
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(executor, context);
      }),
  });
  const base = serviceFor(ex);
  return {
    ...base,
    storeCredentials: (context, input) =>
      ex.transaction(async (tx) => serviceFor(tx).storeCredentials(context, input)),
    revokeCredentials: (context, credentialId, input) =>
      ex.transaction(async (tx) => serviceFor(tx).revokeCredentials(context, credentialId, input)),
  };
}
