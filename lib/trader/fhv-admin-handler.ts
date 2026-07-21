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
  validateFhvAdminCsrf,
} from "@/lib/trader/fhv-admin-csrf";
import { checkAndRecordFhvCommandRateLimit } from "@/lib/trader/fhv-admin-rate-limit-durable";
import { mapFhvActionToConfirmationPhraseClass } from "@/lib/trader/observability/fhv-campaign-control-executor";
import {
  redactHoldoutPayload,
  assertHoldoutGateClosedExposure,
} from "@/lib/trader/observability/fhv-holdout-redaction";
import {
  resolveFhvObserverBridge,
  type FhvObserverBridge,
} from "@/lib/trader/observability/fhv-observer-bridge";
import {
  signFhvOperatorCommandV1,
  type FhvOperatorCommandV1,
} from "@/lib/trader/observability/fhv-operator-command-v1";
import {
  FhvRuntimeConfigError,
  isFhvProductionRuntime,
  requireFhvCommandSecret,
  requireFhvCsrfSecret,
} from "@/lib/trader/observability/fhv-runtime-secrets";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

export type FhvAdminHandlerDeps = AdminRouteHandlerDeps & {
  resolveBridge?: () => FhvObserverBridge;
  env?: NodeJS.ProcessEnv;
};

function mapRuntimeConfigError(err: unknown): AdminRouteHandlerResult {
  if (err instanceof FhvRuntimeConfigError) {
    const status = err.code === "FHV_OBSERVER_UNAVAILABLE" ? 503 : 500;
    return adminClientError(status, err.code, err.message);
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
  const runId = bodyRunId?.trim() || url.searchParams.get("campaign_run_id")?.trim();
  if (!runId) {
    return adminClientError(400, "CAMPAIGN_RUN_ID_REQUIRED", "campaign_run_id is required.");
  }
  return runId;
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

    const redacted = redactHoldoutPayload(status as unknown as Record<string, unknown>, false);
    assertHoldoutGateClosedExposure(redacted);

    const csrfSecret = requireFhvCsrfSecret(deps.env);
    const csrfToken = createFhvAdminCsrfToken(csrfSecret, orgParsed);
    const secure = isFhvProductionRuntime(deps.env);

    return fhvAdminSuccess({ status: redacted }, runtime.kind, {
      "Set-Cookie": buildFhvAdminCsrfSetCookieHeader(csrfToken, secure),
      "x-fhv-csrf-token": csrfToken,
    });
  } catch (err) {
    return mapRuntimeConfigError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
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
    return fhvAdminSuccess({ ...page }, runtime.kind);
  } catch (err) {
    return mapRuntimeConfigError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

type FhvCommandBody = {
  organization_id?: string;
  action?: FhvOperatorCommandV1["action"];
  reason?: string;
  campaign_run_id?: string;
  expected_phase?: string;
  expected_checkpoint_seq?: number;
  idempotency_key?: string;
  confirmation_phrase?: string;
};

function parseFhvCommandBody(raw: unknown): FhvCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "JSON body required.");
  }
  return raw as FhvCommandBody;
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
    const csrfSecret = requireFhvCsrfSecret(deps.env);
    if (!validateFhvAdminCsrf(request, csrfSecret, orgParsed)) {
      return adminClientError(403, "CSRF_INVALID", "CSRF validation failed.");
    }

    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.trader.operations.mutate");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    requireOrgContext(orgParsed);

    const bodyParsed = parseFhvCommandBody(await request.json());
    if ("status" in bodyParsed) {
      return bodyParsed;
    }

    if (bodyParsed.organization_id && bodyParsed.organization_id !== orgParsed) {
      return adminClientError(403, "ORGANIZATION_MISMATCH", "organization_id mismatch.");
    }

    const action = bodyParsed.action;
    const reason = bodyParsed.reason?.trim();
    if (!action || !reason) {
      return adminClientError(400, "COMMAND_INVALID", "action and reason required.");
    }

    const campaignRunId = resolveCampaignRunId(url, bodyParsed.campaign_run_id);
    if (typeof campaignRunId !== "string") {
      return campaignRunId;
    }

    const rate = await checkAndRecordFhvCommandRateLimit(runtime, {
      organizationId: orgParsed,
      operatorId: auth.userId,
      action,
    });
    if (!rate.allowed) {
      return adminClientError(429, "RATE_LIMITED", "Command rate limit exceeded.");
    }

    const bridge = resolveBridge(deps);
    const status = await bridge.fetchStatus({
      organizationId: orgParsed,
      campaignRunId,
      operatorId: auth.userId,
    });

    const confirmationPhraseClass = mapFhvActionToConfirmationPhraseClass(action);
    if (confirmationPhraseClass !== "NONE" && !bodyParsed.confirmation_phrase?.trim()) {
      return adminClientError(
        400,
        "CONFIRMATION_REQUIRED",
        `confirmation_phrase required for ${confirmationPhraseClass}`,
      );
    }

    const issuedAtUtc = new Date().toISOString();
    const expiresAtUtc = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const command = signFhvOperatorCommandV1(
      {
        schemaVersion: "fhv-operator-command/v1",
        commandId: crypto.randomUUID(),
        campaignRunId,
        organizationId: orgParsed,
        operatorId: auth.userId,
        action,
        reason,
        issuedAtUtc,
        expiresAtUtc,
        nonce: crypto.randomUUID().replace(/-/g, ""),
        idempotencyKey: bodyParsed.idempotency_key ?? crypto.randomUUID(),
        expectedCampaignState: {
          phase: bodyParsed.expected_phase ?? status.campaign.phase,
          checkpointSeq: bodyParsed.expected_checkpoint_seq,
        },
        confirmationPhraseClass,
      },
      requireFhvCommandSecret(deps.env),
    );

    const commandResult = await bridge.forwardCommand({
      organizationId: orgParsed,
      campaignRunId,
      operatorId: auth.userId,
      command,
    });

    return fhvAdminSuccess(
      {
        commandResult,
        actor: adminActor(auth.userId),
      },
      runtime.kind,
    );
  } catch (err) {
    return mapRuntimeConfigError(err);
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}
