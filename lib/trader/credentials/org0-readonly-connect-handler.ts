import "server-only";

import { z } from "zod";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { HtxExchangeConnector, HtxExchangeConnectorConfig } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { HtxExchangeConnector as ProductionHtxConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import { assertAdminConsoleSameOrigin } from "@/lib/trader/admin-console/auth";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { adminClientError, adminSuccess, assertAdminPermission,
  type AdminRouteHandlerResult } from "@/lib/trader/admin-route-shared";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { toCredentialMetadataDto } from "@/lib/trader/credentials/connect-api.types";
import { validateHtxConnectCredentials } from "@/lib/trader/credentials/connect-handler";
import { createPostgresCredentialService } from "@/lib/trader/credentials/credential-service";
import { CredentialConflictError } from "@/lib/trader/credentials/errors";
import type { CredentialService } from "@/lib/trader/credentials/types";
import type { Org0ReadOnlyConnectPostBody, Org0ReadOnlyConnectResponse } from "@/lib/trader/credentials/org0-readonly-connect.types";
import { resolveOrg0OrganizationId } from "@/lib/trader/live/org0-allowlist";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { assertCredentialStorageAllowed } from "@/lib/trader/security/credential-storage-gate";
import { buildHtxPermissionMetadata, parseHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import { assertOrgMembershipPostgres, requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export const ORG0_NOMINATED_HTX_ACCOUNT_ID = "73737331" as const;
const TARGET_VENUE = "htx" as const;
const MAX_BODY_BYTES = 4096;
const ACTIVE_CREDENTIAL_UNIQUE_CONSTRAINT = "exchange_credentials_active_org_venue_account_unique";
const bodySchema = z.object({
  apiKey: z.string().min(1).max(256),
  apiSecret: z.string().min(1).max(512),
  expectedActiveCredentialId: z.string().uuid().nullable(),
}).strict();

type PostgresRuntime = Extract<WaiaRuntimeDb, { kind: "postgres" }>;
type Session = Readonly<{ userId: string; runtime: PostgresRuntime; context: OrgContext & { userId: string } }>;

export type Org0ReadOnlyConnectDeps = Readonly<{
  getUserId(): Promise<string | null>;
  hasTraderAccess(userId: string): Promise<boolean>;
  getRuntimeDb(): Promise<WaiaRuntimeDb>;
  disposeRuntimeDb(runtime: WaiaRuntimeDb | undefined): Promise<unknown>;
  resolveOrg0(): string | null;
  checkAdminPermission: typeof assertAdminPermission;
  assertOrgMembership: typeof assertOrgMembershipPostgres;
  assertSameOrigin(request: Request): AdminRouteHandlerResult | null;
  createProvider(): Promise<MasterKeyProvider>;
  createConnector(config: HtxExchangeConnectorConfig): HtxExchangeConnector;
  createCredentialService(runtime: PostgresRuntime, createProvider: () => Promise<MasterKeyProvider>): CredentialService;
}>;

function target(organizationId: string): Org0ReadOnlyConnectResponse["target"] {
  return Object.freeze({ organizationId, venue: TARGET_VENUE,
    exchangeAccountId: ORG0_NOMINATED_HTX_ACCOUNT_ID, marketType: "spot", requiredPermission: "read" });
}

async function authorize(deps: Org0ReadOnlyConnectDeps): Promise<Session | AdminRouteHandlerResult> {
  const userId = await deps.getUserId();
  if (!userId) return adminClientError(401, "UNAUTHORIZED", "Sign in required.");
  if (!(await deps.hasTraderAccess(userId))) {
    return adminClientError(403, "FORBIDDEN", "Trader entitlement required.");
  }
  const org0 = deps.resolveOrg0();
  if (!org0 || !z.string().uuid().safeParse(org0).success) {
    return adminClientError(503, "ORG0_UNAVAILABLE", "Org0 target is unavailable.");
  }
  const runtime = await deps.getRuntimeDb();
  if (runtime.kind !== "postgres") {
    await deps.disposeRuntimeDb(runtime);
    return adminClientError(503, "POSTGRES_REQUIRED", "Org0 credential storage requires PostgreSQL.");
  }
  try {
    const permission = await deps.checkAdminPermission(runtime, userId, org0, "admin.trader.operations.mutate");
    if (!permission.allowed) {
      await deps.disposeRuntimeDb(runtime);
      return adminClientError(403, "FORBIDDEN", "Admin operation permission required.");
    }
    const context = { ...requireOrgContext(org0), userId };
    await deps.assertOrgMembership(runtime.db, context);
    return { userId, runtime, context };
  } catch (error) {
    await deps.disposeRuntimeDb(runtime);
    if (error instanceof Error && error.name === "OrgScopeError") {
      return adminClientError(403, "FORBIDDEN", "Org0 membership required.");
    }
    throw error;
  }
}

function isSession(value: Session | AdminRouteHandlerResult): value is Session {
  return "context" in value;
}

async function reauthorizeBeforeStore(deps: Org0ReadOnlyConnectDeps, session: Session): Promise<boolean> {
  if (!(await deps.hasTraderAccess(session.userId))) return false;
  const permission = await deps.checkAdminPermission(session.runtime, session.userId,
    session.context.organizationId, "admin.trader.operations.mutate");
  if (!permission.allowed || deps.resolveOrg0() !== session.context.organizationId) return false;
  try {
    await deps.assertOrgMembership(session.runtime.db, session.context);
    return true;
  } catch { return false; }
}

function service(deps: Org0ReadOnlyConnectDeps, session: Session, createProvider = deps.createProvider) {
  return deps.createCredentialService(session.runtime, createProvider);
}

function isActiveCredentialInsertRace(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const pg = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (pg.code === "23505" && pg.constraint_name === ACTIVE_CREDENTIAL_UNIQUE_CONSTRAINT) return true;
    current = pg.cause;
  }
  return false;
}

async function activeCredential(deps: Org0ReadOnlyConnectDeps, session: Session) {
  const rows = await service(deps, session).listCredentialMetadata(session.context);
  const matches = rows.filter(row => row.status === "active" && row.venue === TARGET_VENUE &&
    row.exchangeAccountId === ORG0_NOMINATED_HTX_ACCOUNT_ID);
  if (matches.length > 1) throw new Error("ORG0_CREDENTIAL_STATE_AMBIGUOUS");
  return matches[0] ?? null;
}

function response(organizationId: string, credential: Awaited<ReturnType<typeof activeCredential>>): Org0ReadOnlyConnectResponse {
  if (!credential) return { target: target(organizationId), credential: null };
  const dto = toCredentialMetadataDto(credential);
  const parsed = parseHtxPermissionMetadata(credential.permissionMetadata);
  // This endpoint exposes only fixed policy fields, never arbitrary historical
  // metadata/warnings/labels that might contain user-supplied sensitive text.
  const permissionMetadata = parsed && parsed.exchangeAccountId === ORG0_NOMINATED_HTX_ACCOUNT_ID
    ? { version: parsed.version, marketType: parsed.marketType, exchangeAccountId: parsed.exchangeAccountId,
      scopes: parsed.scopes, withdrawForbidden: parsed.withdrawForbidden,
      transferForbidden: parsed.transferForbidden }
    : null;
  return { target: target(organizationId), credential: { ...dto, permissionMetadata } };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("EMPTY_BODY");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
}

export async function handleOrg0ReadOnlyConnectGet(deps: Org0ReadOnlyConnectDeps): Promise<AdminRouteHandlerResult> {
  const auth = await authorize(deps);
  if (!isSession(auth)) return auth;
  try {
    return adminSuccess(response(auth.context.organizationId, await activeCredential(deps, auth)), "postgres");
  } finally { await deps.disposeRuntimeDb(auth.runtime); }
}

export async function handleOrg0ReadOnlyConnectPost(request: Request,
  deps: Org0ReadOnlyConnectDeps): Promise<AdminRouteHandlerResult> {
  const origin = deps.assertSameOrigin(request);
  if (origin) return origin;
  const auth = await authorize(deps);
  if (!isSession(auth)) return auth;
  try {
    let body: Org0ReadOnlyConnectPostBody;
    try {
      body = bodySchema.parse(await readBoundedJson(request)) as Org0ReadOnlyConnectPostBody;
    } catch { return adminClientError(400, "INVALID_BODY", "Invalid credential request."); }
    const apiKey = body.apiKey.trim();
    const apiSecret = body.apiSecret.trim();
    if (!apiKey || !apiSecret) return adminClientError(400, "INVALID_BODY", "Invalid credential request.");

    const current = await activeCredential(deps, auth);
    if ((current?.id ?? null) !== body.expectedActiveCredentialId) {
      return adminClientError(409, "CREDENTIAL_CONFLICT", "Credential state changed. Refresh before reconnecting.");
    }
    let provider: MasterKeyProvider;
    try {
      provider = await deps.createProvider();
      assertCredentialStorageAllowed(provider);
    } catch { return adminClientError(503, "MASTER_KEY_NOT_READY", "Credential storage is unavailable."); }

    let accountInfo: Awaited<ReturnType<HtxExchangeConnector["getAccountInfo"]>>;
    let warnings: readonly string[] | undefined;
    try {
      const { connector, validation } = await validateHtxConnectCredentials({
        createConnector: config => deps.createConnector({ ...config,
          expectedSpotAccountId: ORG0_NOMINATED_HTX_ACCOUNT_ID }),
      }, { venue: TARGET_VENUE, apiKey, apiSecret });
      if (!validation.valid || validation.accountId !== ORG0_NOMINATED_HTX_ACCOUNT_ID) {
        return adminClientError(400, "CREDENTIAL_VALIDATION_FAILED", "HTX read-only credential could not be verified.");
      }
      accountInfo = await connector.getAccountInfo();
      warnings = validation.warnings;
    } catch {
      return adminClientError(400, "CREDENTIAL_VALIDATION_FAILED", "HTX read-only credential could not be verified.");
    }
    if (accountInfo.accountId !== ORG0_NOMINATED_HTX_ACCOUNT_ID || accountInfo.venue !== TARGET_VENUE ||
      accountInfo.marketType !== "spot" || accountInfo.permissions.length !== 1 || accountInfo.permissions[0] !== "read") {
      return adminClientError(400, "CREDENTIAL_VALIDATION_FAILED", "HTX read-only credential could not be verified.");
    }
    const permissionMetadata = buildHtxPermissionMetadata({
      exchangeAccountId: ORG0_NOMINATED_HTX_ACCOUNT_ID, scopes: ["read"], warnings,
    });
    if (!(await reauthorizeBeforeStore(deps, auth))) {
      return adminClientError(403, "FORBIDDEN", "Org0 authorization changed.");
    }
    try {
      const stored = await service(deps, auth, () => Promise.resolve(provider)).storeCredentials(auth.context, {
        venue: TARGET_VENUE,
        exchangeAccountId: ORG0_NOMINATED_HTX_ACCOUNT_ID,
        credentials: { apiKey, apiSecret },
        permissionMetadata,
        expectedActiveCredentialId: body.expectedActiveCredentialId,
        actorType: "admin", actorId: auth.userId,
        orgLiveEnabled: false,
      });
      return adminSuccess(response(auth.context.organizationId, stored), "postgres");
    } catch (error) {
      if (error instanceof CredentialConflictError || isActiveCredentialInsertRace(error)) {
        return adminClientError(409, "CREDENTIAL_CONFLICT", "Credential state changed. Refresh before reconnecting.");
      }
      throw error;
    }
  } finally { await deps.disposeRuntimeDb(auth.runtime); }
}

export function createProductionOrg0ReadOnlyConnectDeps(): Org0ReadOnlyConnectDeps {
  const admin = createProductionAdminRouteDeps();
  return {
    getUserId: admin.getUserId,
    hasTraderAccess: hasTraderAccessForUser,
    getRuntimeDb: admin.getRuntimeDb,
    disposeRuntimeDb: admin.disposeRuntimeDb,
    resolveOrg0: resolveOrg0OrganizationId,
    checkAdminPermission: assertAdminPermission,
    assertOrgMembership: assertOrgMembershipPostgres,
    assertSameOrigin: assertAdminConsoleSameOrigin,
    createProvider: () => createMasterKeyProvider(),
    createConnector: config => new ProductionHtxConnector(config),
    createCredentialService: (runtime, createProvider) =>
      createPostgresCredentialService(runtime.db, { createProvider }),
  };
}
