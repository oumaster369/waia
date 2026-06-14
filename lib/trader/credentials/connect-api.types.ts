import type { CredentialMetadata } from "@/lib/trader/credentials/types";

/** Supported venue for the HTX connect API (v1). */
export const HTX_CONNECT_VENUE = "htx" as const;

export type HtxConnectVenue = typeof HTX_CONNECT_VENUE;

/** POST /api/trader/exchange-credentials/connect request body. */
export type HtxConnectRequestBody = {
  venue: HtxConnectVenue;
  apiKey: string;
  apiSecret: string;
  accountLabel?: string;
};

/** Metadata-only API shape — never includes secrets or ciphertext. */
export type CredentialMetadataDto = {
  id: string;
  venue: string;
  exchangeAccountId: string;
  apiKeyMasked: string | null;
  status: CredentialMetadata["status"];
  permissionMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type HtxConnectSuccessResponse = CredentialMetadataDto;

export type ExchangeCredentialsListResponse = {
  credentials: CredentialMetadataDto[];
};

export const HTX_CONNECT_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_BODY: "INVALID_BODY",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  UNSUPPORTED_VENUE: "UNSUPPORTED_VENUE",
  CREDENTIAL_VALIDATION_FAILED: "CREDENTIAL_VALIDATION_FAILED",
  MASTER_KEY_NOT_READY: "MASTER_KEY_NOT_READY",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type HtxConnectErrorCode =
  (typeof HTX_CONNECT_ERROR_CODES)[keyof typeof HTX_CONNECT_ERROR_CODES];

export function toCredentialMetadataDto(metadata: CredentialMetadata): CredentialMetadataDto {
  return {
    id: metadata.id,
    venue: metadata.venue,
    exchangeAccountId: metadata.exchangeAccountId,
    apiKeyMasked: metadata.apiKeyMasked,
    status: metadata.status,
    permissionMetadata: metadata.permissionMetadata,
    createdAt: metadata.createdAt.toISOString(),
    updatedAt: metadata.updatedAt.toISOString(),
    revokedAt: metadata.revokedAt?.toISOString() ?? null,
  };
}
