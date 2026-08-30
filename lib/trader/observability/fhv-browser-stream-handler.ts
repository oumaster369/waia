import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import {
  authorizeAdminRoute,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
} from "@/lib/trader/admin-route-shared";
import { validateFhvCampaignRunId } from "@/lib/trader/fhv-campaign-run-id";
import { resolveFhvObserverBridge } from "@/lib/trader/observability/fhv-observer-bridge";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

type StreamDeps = Readonly<{
  resolveBridge?: typeof resolveFhvObserverBridge;
  getUserId?: () => Promise<string | null>;
  hasTraderAccess?: (userId: string) => Promise<boolean>;
}>;

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

async function openStream(input: {
  request: Request;
  organizationId: string;
  campaignRunId: string;
  deps?: StreamDeps;
}): Promise<Response> {
  const bridge = (input.deps?.resolveBridge ?? resolveFhvObserverBridge)();
  if (!bridge.openEventStream) {
    return jsonError(503, "FHV_OBSERVER_UNAVAILABLE", "Observer stream unavailable.");
  }
  const upstream = await bridge.openEventStream({
    organizationId: input.organizationId,
    campaignRunId: input.campaignRunId,
    signal: input.request.signal,
    lastEventId: input.request.headers.get("last-event-id"),
  });
  return new Response(upstream.body, { status: 200, headers: STREAM_HEADERS });
}

/** Admin stream is explicitly bound to the selected organization and audit permission. */
export async function handleAdminFhvBrowserStream(
  request: Request,
  adminDeps: AdminRouteHandlerDeps,
  deps?: StreamDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const organizationId = parseOrganizationId(url);
  if (typeof organizationId !== "string") {
    return Response.json(organizationId.body, { status: organizationId.status });
  }
  let campaignRunId: string;
  try {
    campaignRunId = validateFhvCampaignRunId(url.searchParams.get("campaign_run_id") ?? "");
  } catch {
    return jsonError(400, "CAMPAIGN_RUN_ID_INVALID", "Valid campaign_run_id required.");
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(adminDeps, organizationId, "admin.audit.read");
    if (!auth.ok) return Response.json(auth.result.body, { status: auth.result.status });
    runtime = auth.runtime;
    requireOrgContext(organizationId);
    return await openStream({ request, organizationId, campaignRunId, deps });
  } catch {
    return jsonError(503, "FHV_OBSERVER_UNAVAILABLE", "Observer stream unavailable.");
  } finally {
    await adminDeps.disposeRuntimeDb(runtime);
  }
}

/** Tenant stream derives its organization exclusively from the authenticated user. */
export async function handleTenantFhvBrowserStream(
  request: Request,
  deps: StreamDeps = {},
): Promise<Response> {
  const getUserId = deps.getUserId ?? getOptionalSessionUserId;
  const hasAccess = deps.hasTraderAccess ?? hasTraderAccessForUser;
  const userId = await getUserId();
  if (!userId) return jsonError(401, "UNAUTHORIZED", "Session required.");
  if (!(await hasAccess(userId))) {
    return jsonError(403, "FORBIDDEN", "Trader entitlement required.");
  }
  const organizationId = personalOrganizationIdFromUserId(userId);
  requireOrgContext(organizationId).userId = userId;
  let campaignRunId: string;
  try {
    campaignRunId = validateFhvCampaignRunId(
      new URL(request.url).searchParams.get("campaign_run_id") ?? "",
    );
  } catch {
    return jsonError(400, "CAMPAIGN_RUN_ID_INVALID", "Valid campaign_run_id required.");
  }
  try {
    return await openStream({ request, organizationId, campaignRunId, deps });
  } catch {
    return jsonError(503, "FHV_OBSERVER_UNAVAILABLE", "Observer stream unavailable.");
  }
}
