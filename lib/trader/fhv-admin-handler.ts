import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  adminActor,
  adminClientError,
  authorizeAdminRoute,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import {
  buildFhvAdminCsrfSetCookieHeader,
  createFhvAdminCsrfToken,
  FHV_ADMIN_CSRF_HEADER,
  validateFhvAdminCsrf,
} from "@/lib/trader/fhv-admin-csrf";
import { FhvCampaignRunIdError, validateFhvCampaignRunId } from "@/lib/trader/fhv-campaign-run-id";
import { checkAndRecordFhvCommandRateLimit } from "@/lib/trader/fhv-admin-rate-limit-durable";
import {
  FhvAdminCommandRequestError,
  parseFhvAdminCommandRequest,
} from "@/lib/trader/observability/fhv-admin-command-request-schema";
import {
  redactHoldoutPayload,
  assertHoldoutGateClosedExposure,
} from "@/lib/trader/observability/fhv-holdout-redaction";
import {
  resolveFhvObserverBridge,
  type FhvObserverBridge,
} from "@/lib/trader/observability/fhv-observer-bridge";
import { signFhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import {
  FhvRuntimeConfigError,
  isFhvProductionRuntime,
  requireFhvCommandSecret,
  requireFhvCsrfSecret,
} from "@/lib/trader/observability/fhv-runtime-secrets";
import { FhvRuntimeResponseValidationError } from "@/lib/trader/observability/fhv-runtime-response-validators";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type FhvAdminHandlerDeps = AdminRouteHandlerDeps & {
  resolveBridge?: () => FhvObserverBridge;
  env?: NodeJS.ProcessEnv;
};

export const FHV_COMMAND_CAPABILITY = {
  commandContractFailClosed: true,
  commandsActuallyEnforced: false,
  supervisorExecutorImplemented: true,
  supervisorQualificationRequired: true,
} as const;

function mapRuntimeConfigError(err: unknown): AdminRouteHandlerResult {
  if (err instanceof FhvRuntimeConfigError) {
    const status = err.code === "FHV_OBSERVER_UNAVAILABLE" ? 503 : 500;
    return adminClientError(status, err.code, err.message);
  }
  if (err instanceof FhvRuntimeResponseValidationError) {
    return adminClientError(502, err.code, err.message);
  }
  if (err instanceof FhvCampaignRunIdError || err instanceof FhvAdminCommandRequestError) {
    return adminClientError(400, err.code, err.message);
  }
  if (err instanceof Error) {
    return adminClientError(400, "BAD_REQUEST", err.message);
  }
  return adminClientError(400, "BAD_REQUEST", "Request failed.");
}

function resolveBridge(deps: FhvAdminHandlerDeps): FhvObserverBridge {
  return deps.resolveBridge?.() ?? resolveFhvObserverBridge(deps.env ?? process.env);
}

function resolveCampaignRunId(url: URL, bodyRunId?: string): string | AdminRouteHandlerResult {
  try {
    const runId = bodyRunId?.trim() || url.searchParams.get("campaign_run_id")?.trim() || "";
    return validateFhvCampaignRunId(runId);
  } catch (err) {
    return mapRuntimeConfigError(err);
  }
}

function assertStatusRunBinding(
  status: { campaign: { runId: string } },
  expectedRunId: string,
): void {
  if (status.campaign.runId !== expectedRunId) {
    throw new FhvRuntimeResponseValidationError("RUN_BINDING_FAILED", "Status run mismatch.");
  }
}

function fhvAdminSuccess(
  body: Record<string, unknown>,
  waiaDbBackend: "sqlite" | "postgres" | undefined,
  responseHeaders?: Record<string, string>,
): AdminRouteHandlerResult {
  return {
    status: 200,
    body,
    outcome: "success",
    waiaDbBackend,
    responseHeaders,
  };
}

export async function handleAdminFhvOperationsStatusGet(
  request: Request,
  deps: FhvAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }
  const campaignRunId = resolveCampaignRunId(url);
  if (typeof campaignRunId !== "string") {
    return campaignRunId;
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    requireOrgContext(orgParsed);

    const bridge = resolveBridge(deps);
    const status = await bridge.fetchStatus({
      organizationId: orgParsed,
      campaignRunId,
      operatorId: auth.userId,
    });
    assertStatusRunBinding(status, campaignRunId);

    const redacted = redactHoldoutPayload(status as unknown as Record<string, unknown>, false);
    assertHoldoutGateClosedExposure(redacted);

    const csrfSecret = requireFhvCsrfSecret(deps.env);
    const csrfToken = createFhvAdminCsrfToken(csrfSecret, orgParsed, auth.userId);
    const secure = isFhvProductionRuntime(deps.env);

    return fhvAdminSuccess(
      {
        status: redacted,
        campaignRunId,
        capabilities: FHV_COMMAND_CAPABILITY,
      },
      runtime.kind,
      {
        "Set-Cookie": buildFhvAdminCsrfSetCookieHeader(csrfToken, secure),
        [FHV_ADMIN_CSRF_HEADER]: csrfToken,
      },
    );
  } catch (err) {
    return mapRuntimeConfigError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export async function handleAdminFhvOperationsDetailGet(
  request: Request,
  deps: FhvAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }
  const campaignRunId = resolveCampaignRunId(url);
  if (typeof campaignRunId !== "string") {
    return campaignRunId;
  }
  const kind = url.searchParams.get("kind")?.trim();
  if (!kind) {
    return adminClientError(400, "DETAIL_KIND_REQUIRED", "kind query param required.");
  }
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    const bridge = resolveBridge(deps);
    const page = await bridge.fetchDetail({
      organizationId: orgParsed,
      campaignRunId,
      kind,
      cursor,
      limit,
    });
    return fhvAdminSuccess({ ...page, schemaVersion: "fhv-detail-page/v1" }, runtime.kind);
  } catch (err) {
    return mapRuntimeConfigError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export async function handleAdminFhvOperationsCommandPost(
  request: Request,
  deps: FhvAdminHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.trader.operations.mutate");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    requireOrgContext(orgParsed);

    const csrfSecret = requireFhvCsrfSecret(deps.env);
    if (!validateFhvAdminCsrf(request, csrfSecret, orgParsed, auth.userId)) {
      return adminClientError(403, "CSRF_INVALID", "CSRF validation failed.");
    }

    const urlCampaignRunId = url.searchParams.get("campaign_run_id");
    const parsed = parseFhvAdminCommandRequest({
      organizationId: orgParsed,
      urlCampaignRunId,
      rawBody: await request.json(),
    });

    const rate = await checkAndRecordFhvCommandRateLimit(runtime, {
      organizationId: parsed.organizationId,
      operatorId: auth.userId,
      action: parsed.action,
    });
    if (!rate.allowed) {
      return adminClientError(429, "RATE_LIMITED", "Command rate limit exceeded.");
    }

    const bridge = resolveBridge(deps);
    const status = await bridge.fetchStatus({
      organizationId: parsed.organizationId,
      campaignRunId: parsed.campaignRunId,
      operatorId: auth.userId,
    });
    assertStatusRunBinding(status, parsed.campaignRunId);

    const issuedAtUtc = new Date().toISOString();
    const expiresAtUtc = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const expectedCampaignState =
      parsed.expectedCheckpointSeq !== undefined
        ? {
            phase: parsed.expectedPhase ?? status.campaign.phase,
            checkpointSeq: parsed.expectedCheckpointSeq,
          }
        : { phase: parsed.expectedPhase ?? status.campaign.phase };
    const command = signFhvOperatorCommandV1(
      {
        schemaVersion: "fhv-operator-command/v1",
        commandId: crypto.randomUUID(),
        campaignRunId: parsed.campaignRunId,
        organizationId: parsed.organizationId,
        operatorId: auth.userId,
        action: parsed.action,
        reason: parsed.reason,
        issuedAtUtc,
        expiresAtUtc,
        nonce: crypto.randomUUID().replace(/-/g, ""),
        idempotencyKey: parsed.idempotencyKey ?? crypto.randomUUID(),
        expectedCampaignState,
        confirmationPhraseClass: parsed.confirmationPhraseClass,
      },
      requireFhvCommandSecret(deps.env),
    );

    const commandResult = await bridge.forwardCommand({
      organizationId: parsed.organizationId,
      campaignRunId: parsed.campaignRunId,
      operatorId: auth.userId,
      command,
    });

    return fhvAdminSuccess(
      {
        commandResult,
        actor: adminActor(auth.userId),
        capabilities: FHV_COMMAND_CAPABILITY,
      },
      runtime.kind,
    );
  } catch (err) {
    return mapRuntimeConfigError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
