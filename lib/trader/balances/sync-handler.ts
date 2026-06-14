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
  createPostgresBalanceSnapshotService,
  createSqliteBalanceSnapshotService,
} from "@/lib/trader/balances/balance-snapshot-service";
import {
  DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT,
  HTX_BALANCE_SYNC_ERROR_CODES,
  MAX_BALANCE_SNAPSHOTS_LIST_LIMIT,
} from "@/lib/trader/balances/sync-api.types";
import type { BalanceSnapshotService } from "@/lib/trader/balances/types";
import {
  toBalanceSnapshotDto,
  type BalanceSnapshotsListResponse,
  type BalanceSyncSuccessResponse,
} from "@/lib/trader/balances/types";
import {
  createPostgresCredentialService,
  createSqliteCredentialService,
} from "@/lib/trader/credentials/credential-service";
import { CredentialDecryptError, CredentialNotFoundError } from "@/lib/trader/credentials/errors";
import type { CredentialService } from "@/lib/trader/credentials/types";
import {
  HtxExchangeConnector,
  type HtxExchangeConnectorConfig,
} from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { MasterKeyNotReadyError } from "@/lib/trader/security/errors";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type BalanceSyncHandlerResult = {
  status: number;
  body: ApiErrorEnvelope | BalanceSyncSuccessResponse | BalanceSnapshotsListResponse;
  outcome: WaiaRuntimeRouteOutcome;
  errorClass?: string;
  waiaDbBackend?: "sqlite" | "postgres";
};

export type BalanceSyncHandlerDeps = {
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
  createBalanceSnapshotService: (runtime: WaiaRuntimeDb) => BalanceSnapshotService;
};

function errorEnvelope(code: string, message: string): ApiErrorEnvelope {
  return { error: { code, message } };
}

function clientError(status: number, code: string, message: string): BalanceSyncHandlerResult {
  return {
    status,
    body: errorEnvelope(code, message),
    outcome: "client_error",
  };
}

function isHandlerErrorResult(value: unknown): value is BalanceSyncHandlerResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "body" in value &&
    "outcome" in value
  );
}

async function requireAuthenticatedTrader(
  deps: BalanceSyncHandlerDeps,
): Promise<{ userId: string } | BalanceSyncHandlerResult> {
  const userId = await deps.getUserId();
  if (!userId) {
    return clientError(401, HTX_BALANCE_SYNC_ERROR_CODES.UNAUTHORIZED, "Session required.");
  }

  const hasAccess = await deps.hasTraderAccess(userId);
  if (!hasAccess) {
    return clientError(403, HTX_BALANCE_SYNC_ERROR_CODES.FORBIDDEN, "Trader entitlement required.");
  }

  return { userId };
}

function parseCredentialId(raw: string): string | BalanceSyncHandlerResult {
  const credentialId = raw.trim();
  if (!credentialId) {
    return clientError(
      400,
      HTX_BALANCE_SYNC_ERROR_CODES.INVALID_CREDENTIAL_ID,
      "credentialId is required.",
    );
  }
  return credentialId;
}

function parseListQuery(searchParams: URLSearchParams): {
  credentialId?: string;
  limit?: number;
} {
  const credentialId = searchParams.get("credentialId")?.trim() || undefined;

  const limitRaw = searchParams.get("limit");
  if (limitRaw === null || limitRaw.trim() === "") {
    return { credentialId, limit: DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT };
  }

  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { credentialId, limit: DEFAULT_BALANCE_SNAPSHOTS_LIST_LIMIT };
  }

  return {
    credentialId,
    limit: Math.min(parsed, MAX_BALANCE_SNAPSHOTS_LIST_LIMIT),
  };
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

function createBalanceSnapshotServiceFromRuntime(runtime: WaiaRuntimeDb): BalanceSnapshotService {
  if (runtime.kind === "sqlite") {
    return createSqliteBalanceSnapshotService(runtime.db);
  }
  return createPostgresBalanceSnapshotService(runtime.db);
}

export async function handleBalanceSyncPost(
  credentialIdRaw: string,
  deps: BalanceSyncHandlerDeps,
): Promise<BalanceSyncHandlerResult> {
  const auth = await requireAuthenticatedTrader(deps);
  if (isHandlerErrorResult(auth)) {
    return auth;
  }

  const credentialIdOrError = parseCredentialId(credentialIdRaw);
  if (isHandlerErrorResult(credentialIdOrError)) {
    return credentialIdOrError;
  }
  const credentialId = credentialIdOrError;

  const organizationId = personalOrganizationIdFromUserId(auth.userId);
  const context = requireOrgContext(organizationId);
  context.userId = auth.userId;

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  try {
    const runtime = await deps.getRuntimeDb();
    resolvedRuntime = runtime;

    const credentialService = deps.createCredentialService(runtime, deps.createProvider);
    const snapshotService = deps.createBalanceSnapshotService(runtime);

    const credentials = await credentialService.listCredentialMetadata(context);
    const metadata = credentials.find((row) => row.id === credentialId);
    if (!metadata || metadata.status !== "active") {
      return clientError(
        404,
        HTX_BALANCE_SYNC_ERROR_CODES.CREDENTIAL_NOT_FOUND,
        "Active exchange credential not found.",
      );
    }

    let decrypted;
    try {
      decrypted = await credentialService.getDecryptedCredentials(context, credentialId);
    } catch (err) {
      if (err instanceof CredentialNotFoundError) {
        return clientError(
          404,
          HTX_BALANCE_SYNC_ERROR_CODES.CREDENTIAL_NOT_FOUND,
          "Active exchange credential not found.",
        );
      }
      if (err instanceof MasterKeyNotReadyError) {
        return clientError(
          503,
          HTX_BALANCE_SYNC_ERROR_CODES.MASTER_KEY_NOT_READY,
          "Credential decryption is not available until master key provisioning is complete.",
        );
      }
      if (err instanceof CredentialDecryptError) {
        return clientError(
          503,
          HTX_BALANCE_SYNC_ERROR_CODES.DECRYPT_UNAVAILABLE,
          "Stored credential could not be decrypted.",
        );
      }
      throw err;
    }

    const connector = deps.createConnector({
      apiKey: decrypted.apiKey,
      apiSecret: decrypted.apiSecret,
    });

    const validation = await connector.validateCredentials({
      apiKey: decrypted.apiKey,
      apiSecret: decrypted.apiSecret,
    });

    if (!validation.valid) {
      const detail = validation.errorCode ?? "VALIDATION_FAILED";
      return {
        status: 502,
        body: errorEnvelope(
          HTX_BALANCE_SYNC_ERROR_CODES.BALANCE_SYNC_VALIDATION_FAILED,
          `HTX credential validation failed (${detail}).`,
        ),
        outcome: "client_error",
        waiaDbBackend: runtime.kind,
      };
    }

    let balances;
    try {
      balances = await connector.getBalances();
    } catch {
      return {
        status: 502,
        body: errorEnvelope(
          HTX_BALANCE_SYNC_ERROR_CODES.BALANCE_FETCH_FAILED,
          "Failed to fetch balances from HTX.",
        ),
        outcome: "client_error",
        waiaDbBackend: runtime.kind,
      };
    }

    const syncedAt = new Date();
    const snapshot = await snapshotService.recordSnapshot(context, {
      credentialId,
      venue: metadata.venue,
      exchangeAccountId: metadata.exchangeAccountId,
      balances,
      syncedAt,
      actorType: "user",
      actorId: auth.userId,
    });

    return {
      status: 200,
      body: toBalanceSnapshotDto(snapshot),
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (err) {
    const outcome = !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    return {
      status: 500,
      body: errorEnvelope(HTX_BALANCE_SYNC_ERROR_CODES.INTERNAL_ERROR, "Something went wrong."),
      outcome,
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: resolvedRuntime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(resolvedRuntime);
  }
}

export async function handleBalanceSnapshotsGet(
  request: Request,
  deps: BalanceSyncHandlerDeps,
): Promise<BalanceSyncHandlerResult> {
  const auth = await requireAuthenticatedTrader(deps);
  if (isHandlerErrorResult(auth)) {
    return auth;
  }

  const organizationId = personalOrganizationIdFromUserId(auth.userId);
  const context = requireOrgContext(organizationId);
  context.userId = auth.userId;

  const url = new URL(request.url);
  const query = parseListQuery(url.searchParams);

  let resolvedRuntime: WaiaRuntimeDb | undefined;
  try {
    const runtime = await deps.getRuntimeDb();
    resolvedRuntime = runtime;

    const snapshotService = deps.createBalanceSnapshotService(runtime);
    const snapshots = await snapshotService.listSnapshots(context, query);

    return {
      status: 200,
      body: {
        snapshots: snapshots.map(toBalanceSnapshotDto),
      },
      outcome: "success",
      waiaDbBackend: runtime.kind,
    };
  } catch (err) {
    const outcome = !resolvedRuntime && isWaiaConfigError(err) ? "config_error" : "internal_error";
    return {
      status: 500,
      body: errorEnvelope(HTX_BALANCE_SYNC_ERROR_CODES.INTERNAL_ERROR, "Something went wrong."),
      outcome,
      errorClass: safeTelemetryErrorClass(err),
      waiaDbBackend: resolvedRuntime?.kind,
    };
  } finally {
    await deps.disposeRuntimeDb(resolvedRuntime);
  }
}

/** Production defaults for route handlers (DEE-237). */
export function createProductionBalanceSyncDeps(): BalanceSyncHandlerDeps {
  return {
    getUserId: getOptionalSessionUserId,
    hasTraderAccess: hasTraderAccessForUser,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
    createProvider: () => createMasterKeyProvider(),
    createConnector: (config) => new HtxExchangeConnector(config),
    createCredentialService: createCredentialServiceFromRuntime,
    createBalanceSnapshotService: createBalanceSnapshotServiceFromRuntime,
  };
}
