import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

export type {
  CredentialMetadata,
  CredentialService,
  CredentialServiceDeps,
  ExchangeCredentialRepository,
  ExchangeCredentialRow,
  ExchangeCredentialStatus,
  InsertExchangeCredentialRowInput,
  RevokeCredentialsInput,
  StoreCredentialsInput,
} from "@/lib/trader/credentials/types";
export {
  CredentialDecryptError,
  CredentialConflictError,
  CredentialError,
  CredentialNotFoundError,
  CredentialPayloadInvalidError,
  CREDENTIAL_ERROR_CODES,
  type CredentialErrorCode,
} from "@/lib/trader/credentials/errors";
export {
  decryptCredentialPayload,
  encryptCredentialPayload,
  type EncryptedCredentialPayload,
} from "@/lib/trader/credentials/envelope-crypto";
export { maskApiKey } from "@/lib/trader/credentials/masking";
export {
  createCredentialService,
  createPostgresCredentialService,
  createSqliteCredentialService,
} from "@/lib/trader/credentials/credential-service";
export {
  createPostgresExchangeCredentialRepository,
  createSqliteExchangeCredentialRepository,
} from "@/lib/trader/credentials/repository-adapters";
export {
  getCredentialRowByIdPostgres,
  insertCredentialRowPostgres,
  listCredentialRowsForOrgPostgres,
  revokeCredentialRowPostgres,
} from "@/lib/trader/credentials/repository-postgres";
export {
  getCredentialRowByIdSqlite,
  insertCredentialRowSqlite,
  listCredentialRowsForOrgSqlite,
  revokeCredentialRowSqlite,
} from "@/lib/trader/credentials/repository-sqlite";
export type {
  CredentialMetadataDto,
  ExchangeCredentialsListResponse,
  HtxConnectRequestBody,
  HtxConnectSuccessResponse,
  HtxConnectVenue,
} from "@/lib/trader/credentials/connect-api.types";
export {
  HTX_CONNECT_ERROR_CODES,
  HTX_CONNECT_VENUE,
  toCredentialMetadataDto,
} from "@/lib/trader/credentials/connect-api.types";
export {
  createProductionConnectDeps,
  handleExchangeCredentialsGet,
  handleExchangeCredentialDelete,
  handleHtxConnectPost,
  type ConnectHandlerDeps,
  type ConnectHandlerResult,
} from "@/lib/trader/credentials/connect-handler";
