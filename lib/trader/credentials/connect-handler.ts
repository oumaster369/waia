import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { ApiErrorEnvelope } from "@/lib/auth/json-errors";
import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import type { WaiaRuntimeRouteOutcome } from "@/lib/observability/waia-runtime-route-telemetry";
import {
  isWaiaConfigError,
  safeTelemetryErrorClass,
} from "@/lib/observability/waia-runtime-route-telemetry";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import {
  HTX_CONNECT_ERROR_CODES,
  HTX_CONNECT_VENUE,
  toCredentialMetadataDto,
  type ExchangeCredentialsListResponse,
  type HtxConnectRequestBody,
  type HtxConnectSuccessResponse,
} from "@/lib/trader/credentials/connect-api.types";
import {
  createPostgresCredentialService,
  createSqliteCredentialService,
} from "@/lib/trader/credentials/credential-service";
import type { CredentialService } from "@/lib/trader/credentials/types";
import {
  CredentialConflictError,
  CredentialNotFoundError,
} from "@/lib/trader/credentials/errors";
import {
  HtxExchangeConnector,
  type HtxExchangeConnectorConfig,
} from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { assertCredentialStorageAllowed } from "@/lib/trader/security/credential-storage-gate";
import { buildHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import { MasterKeyNotReadyError } from "@/lib/trader/security/errors";
import { sanitizeClientErrorMessage } from "@/lib/trader/security/redaction";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type ConnectHandlerResult = {
  status: number;
  body: ApiErrorEnvelope | HtxConnectSuccessResponse | ExchangeCredentialsListResponse;
  outcome: WaiaRuntimeRouteOutcome;
  errorClass?: string;
  waiaDbBackend?: "sqlite" | "postgres";
};

export type ConnectHandlerDeps = {
  getUserId: () => Promise<string | null>;
  hasTraderAccess: (userId: string) => Promise<boolean>;
  getRuntimeDb: () => Promise<WaiaRuntimeDb>;
  disposeRuntimeDb: (runtime: WaiaRuntimeDb | undefined) => Promise<unknown>;
  createProvider: () => Promise<MasterKeyProvider>;
  createConnector: (config: HtxExchangeConnectorConfig) => HtxExchangeConnector;
  createCredentialService: (
    runtime: WaiaRuntimeDb,
    createProvider: () => Promise<MasterKeyProvider>,
  ) => CredentialService;
};

function errorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

function clientError(status: number, code: string, message: string): ConnectHandlerResult {
  return {
    status,
    body: errorEnvelope(code, message),
    outcome: "client_error",
  };
}

function parseConnectBody(raw: unknown): HtxConnectRequestBody | ConnectHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return clientError(
      400,
      HTX_CONNECT_ERROR_CODES.INVALID_BODY,
      "Request body must be a JSON object.",
    );
  }

  const body = raw as Record<string, unknown>;
  const venue = body.venue;
  if (venue !== HTX_CONNECT_VENUE) {
    return clientError(
      400,
      HTX_CONNECT_ERROR_CODES.UNSUPPORTED_VENUE,
      `Unsupported venue. Only "${HTX_CONNECT_VENUE}" is supported.`,
    );
  }

  if (typeof body.apiKey !== "string" || typeof body.apiSecret !== "string") {
    return clientError(
      400,
      HTX_CONNECT_ERROR_CODES.INVALID_BODY,
      "apiKey and apiSecret must be strings.",
    );
  }

  const apiKey = body.apiKey.trim();
  const apiSecret = body.apiSecret.trim();
  if (!apiKey || !apiSecret) {
    return clientError(
      400,
      HTX_CONNECT_ERROR_CODES.INVALID_CREDENTIALS,
      "apiKey and apiSecret must not be empty.",
    );
  }

  let accountLabel: string | undefined;
  if (body.accountLabel !== undefined && body.accountLabel !== null) {
    if (typeof body.accountLabel !== "string") {
      return clientError(
        400,
        HTX_CONNECT_ERROR_CODES.INVALID_BODY,
        "accountLabel must be a string when provided.",
      );
    }
    const trimmedLabel = body.accountLabel.trim();
    accountLabel = trimmedLabel.length > 0 ? trimmedLabel : undefined;
  }

  let replacementCredentialId: string | undefined;
  if (body.replacementCredentialId !== undefined && body.replacementCredentialId !== null) {
    if (typeof body.replacementCredentialId !== "string" || !body.replacementCredentialId.trim()) {
      return clientError(
        400,
        HTX_CONNECT_ERROR_CODES.INVALID_BODY,
        "replacementCredentialId must be a non-empty string when provided.",
      );
    }
    replacementCredentialId = body.replacementCredentialId.trim();
  }

  return {
    venue: HTX_CONNECT_VENUE,
    apiKey,
    apiSecret,
    accountLabel,
    replacementCredentialId,
  };
}

function isHandlerErrorResult(value: unknown): value is ConnectHandlerResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "body" in value &&
    "outcome" in value
  );
}

async function requireAuthenticatedTrader(
  deps: ConnectHandlerDeps,
): Promise<{ userId: string } | ConnectHandlerResult> {
  const userId = await deps.getUserId();
  if (!userId) {
    return clientError(401, HTX_CONNECT_ERROR_CODES.UNAUTHORIZED, "Session required.");
  }

  const hasAccess = await deps.hasTraderAccess(userId);
  if (!hasAccess) {
    return clientError(403, HTX_CONNECT_ERROR_CODES.FORBIDDEN, "Trader entitlement required.");
  }

  return { userId };
}

export async function handleHtxConnectPost(
  request: Request,
  deps: ConnectHandlerDeps,
): Promise<ConnectHandlerResult> {
  const auth = await requireAuthenticatedTrader(deps);
  if (isHandlerErrorResult(auth)) {
    return auth;
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return clientError(400, HTX_CONNECT_ERROR_CODES.INVALID_BODY, "Expected JSON body.");
  }

  const bodyOrError = parseConnectBody(parsed);
  if (isHandlerErrorResult(bodyOrError)) {
    return bodyOrError;
  }
  const body = bodyOrError;

  let provider: MasterKeyProvider;
  try {
    provider = await deps.createProvider();
    assertCredentialStorageAllowed(provider);
  } catch (err) {
    if (err instanceof MasterKeyNotReadyError) {
      return clientError(
        503,
        HTX_CONNECT_ERROR_CODES.MASTER_KEY_NOT_READY,
        "Credential storage is not available until master key provisioning is complete.",
      );
    }
    throw err;
  }

  const connector = deps.createConnector({
    apiKey: body.apiKey,
    apiSecret: body.apiSecret,
  });

  const validation = await connector.validateCredentials({
    apiKey: body.apiKey,
    apiSecret: body.apiSecret,
  });

  if (!validation.valid) {
    const detail = validation.errorCode ?? "VALIDATION_FAILED";
    return clientError(
      400,
      HTX_CONNECT_ERROR_CODES.CREDENTIAL_VALIDATION_FAILED,
      sanitizeClientErrorMessage(`HTX credential validation failed (${detail}).`),
    );
  }

  if (!validation.accountId) {
    return clientError(
      400,
      HTX_CONNECT_ERROR_CODES.CREDENTIAL_VALIDATION_FAILED,
      "HTX credential validation succeeded but no account id was returned.",
    );
  }

  const organizationId = personalOrganizationIdFromUserId(auth.userId);
  const context = requireOrgContext(organizationId);
  context.userId = auth.userId;

  const accountInfo = await connector.getAccountInfo();

  const permissionMetadata = buildHtxPermissionMetadata({
    exchangeAccountId: validation.accountId,
    scopes: accountInfo.permissions,
    warnings: validation.warnings,
    accountLabel: body.accountLabel,
  });

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  try {
    const runtime = await deps.getRuntimeDb();
    resolvedRuntime = runtime;

    const service = deps.createCredentialService(runtime, () => Promise.resolve(provider));
    const metadata = await service.storeCredentials(context, {
      venue: body.venue,
      exchangeAccountId: validation.accountId,
      credentials: {
        apiKey: body.apiKey,
        apiSecret: body.apiSecret,
      },
      permissionMetadata,
      actorType: "user",
      actorId: auth.userId,
      expectedActiveCredentialId: body.replacementCredentialId ?? null,
    });

    return {
      status: 200,
      body: toCredentialMetadataDto(metadata),
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (err) {
    if (err instanceof CredentialConflictError) {
      return clientError(
        409,
        HTX_CONNECT_ERROR_CODES.CREDENTIAL_CONFLICT,
        "Credential state changed. Refresh before reconnecting.",
      );
    }
    const outcome = !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    return {
      status: 500,
      body: errorEnvelope(HTX_CONNECT_ERROR_CODES.INTERNAL_ERROR, "Something went wrong."),
      outcome,
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: resolvedRuntime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(resolvedRuntime);
  }
}

export async function handleExchangeCredentialDelete(
  credentialId: string,
  deps: ConnectHandlerDeps,
): Promise<ConnectHandlerResult> {
  const auth = await requireAuthenticatedTrader(deps);
  if (isHandlerErrorResult(auth)) return auth;
  if (!credentialId) {
    return clientError(400, HTX_CONNECT_ERROR_CODES.INVALID_BODY, "credentialId is required.");
  }

  const context = requireOrgContext(personalOrganizationIdFromUserId(auth.userId));
  context.userId = auth.userId;
  let resolvedRuntime: WaiaRuntimeDb | undefined;
  try {
    const runtime = await deps.getRuntimeDb();
    resolvedRuntime = runtime;
    const service = deps.createCredentialService(runtime, deps.createProvider);
    const metadata = await service.revokeCredentials(context, credentialId, {
      actorType: "user",
      actorId: auth.userId,
    });
    return {
      status: 200,
      body: toCredentialMetadataDto(metadata),
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      return clientError(
        404,
        HTX_CONNECT_ERROR_CODES.CREDENTIAL_NOT_FOUND,
        "Credential not found.",
      );
    }
    if (err instanceof CredentialConflictError) {
      return clientError(
        409,
        HTX_CONNECT_ERROR_CODES.CREDENTIAL_CONFLICT,
        "Credential state changed. Refresh before retrying.",
      );
    }
    const outcome = !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    return {
      status: 500,
      body: errorEnvelope(HTX_CONNECT_ERROR_CODES.INTERNAL_ERROR, "Something went wrong."),
      outcome,
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: resolvedRuntime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(resolvedRuntime);
  }
}

export async function handleExchangeCredentialsGet(
  deps: ConnectHandlerDeps,
): Promise<ConnectHandlerResult> {
  const auth = await requireAuthenticatedTrader(deps);
  if (isHandlerErrorResult(auth)) {
    return auth;
  }

  const organizationId = personalOrganizationIdFromUserId(auth.userId);
  const context = requireOrgContext(organizationId);
  context.userId = auth.userId;

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  try {
    const runtime = await deps.getRuntimeDb();
    resolvedRuntime = runtime;

    const service = deps.createCredentialService(runtime, deps.createProvider);
    const rows = await service.listCredentialMetadata(context);

    return {
      status: 200,
      body: {
        credentials: rows.map(toCredentialMetadataDto),
      },
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (err) {
    const outcome = !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    return {
      status: 500,
      body: errorEnvelope(HTX_CONNECT_ERROR_CODES.INTERNAL_ERROR, "Something went wrong."),
      outcome,
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: resolvedRuntime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(resolvedRuntime);
  }
}

function createCredentialServiceFromRuntime(
  runtime: WaiaRuntimeDb,
  createProvider: () => Promise<MasterKeyProvider>,
): CredentialService {
  if (runtime.kind === "sqlite") {
    return createSqliteCredentialService(runtime.db, { createProvider });
  }
  return createPostgresCredentialService(runtime.db, { createProvider });
}

/** Production defaults for route handlers (DEE-236). */
export function createProductionConnectDeps(): ConnectHandlerDeps {
  return {
    getUserId: getOptionalSessionUserId,
    hasTraderAccess: hasTraderAccessForUser,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
    createProvider: () => createMasterKeyProvider(),
    createConnector: (config) => new HtxExchangeConnector(config),
    createCredentialService: createCredentialServiceFromRuntime,
  };
}
