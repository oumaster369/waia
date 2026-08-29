import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ExchangeCredentialStatus = "active" | "revoked";

/** Opaque persistence row — ciphertext fields are never parsed in DEE-233. */
export type ExchangeCredentialRow = {
  id: string;
  organizationId: string;
  venue: string;
  exchangeAccountId: string;
  apiKeyMasked: string | null;
  encryptedPayload: string | null;
  payloadKeyVersion: string | null;
  wrappedDekKeyVersion: string | null;
  wrappedDekKey: string | null;
  permissionMetadata: string | null;
  status: ExchangeCredentialStatus;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

export type InsertExchangeCredentialRowInput = {
  venue: string;
  exchangeAccountId: string;
  apiKeyMasked?: string | null;
  encryptedPayload?: string | null;
  payloadKeyVersion?: string | null;
  wrappedDekKeyVersion?: string | null;
  wrappedDekKey?: string | null;
  permissionMetadata?: string | null;
};

export type ExchangeCredentialRepository = {
  insertCredentialRow(
    context: OrgContext,
    input: InsertExchangeCredentialRowInput,
  ): ExchangeCredentialRow | Promise<ExchangeCredentialRow>;
  getCredentialRowById(
    context: OrgContext,
    credentialId: string,
  ): ExchangeCredentialRow | null | Promise<ExchangeCredentialRow | null>;
  listCredentialRowsForOrg(
    context: OrgContext,
  ): ExchangeCredentialRow[] | Promise<ExchangeCredentialRow[]>;
  revokeCredentialRow(
    context: OrgContext,
    credentialId: string,
  ): ExchangeCredentialRow | null | Promise<ExchangeCredentialRow | null>;
};

/** Metadata returned by credential lifecycle methods — never includes secrets. */
export type CredentialMetadata = {
  id: string;
  venue: string;
  exchangeAccountId: string;
  apiKeyMasked: string | null;
  status: ExchangeCredentialStatus;
  permissionMetadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

export type StoreCredentialsInput = {
  venue: string;
  exchangeAccountId: string;
  credentials: ConnectorCredentialInput;
  permissionMetadata?: Record<string, unknown> | null;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
  /** Optimistic replacement guard. null means the caller observed no active credential. */
  expectedActiveCredentialId?: string | null;
};

export type RevokeCredentialsInput = {
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
};

export type CredentialServiceDeps = {
  repository: ExchangeCredentialRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  createProvider?: () => Promise<MasterKeyProvider>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type CredentialService = {
  storeCredentials(context: OrgContext, input: StoreCredentialsInput): Promise<CredentialMetadata>;
  getDecryptedCredentials(
    context: OrgContext,
    credentialId: string,
  ): Promise<ConnectorCredentialInput>;
  revokeCredentials(
    context: OrgContext,
    credentialId: string,
    input?: RevokeCredentialsInput,
  ): Promise<CredentialMetadata>;
  listCredentialMetadata(context: OrgContext): Promise<CredentialMetadata[]>;
};
