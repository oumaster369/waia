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
