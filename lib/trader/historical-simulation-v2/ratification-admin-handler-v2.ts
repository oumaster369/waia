import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

import { createPerRequestPostgresRuntime, disposePostgresClientSafely } from
  "@/db/postgres-client";
import { buildFhvAdminCsrfSetCookieHeader, createFhvAdminCsrfToken,
  FHV_ADMIN_CSRF_HEADER, validateFhvAdminCsrf } from "@/lib/trader/fhv-admin-csrf";
import { isFhvProductionRuntime, requireFhvCsrfSecret } from
  "@/lib/trader/observability/fhv-runtime-secrets";
import { adminClientError, authorizeAdminRoute, parseOrganizationId,
  type AdminRouteHandlerDeps, type AdminRouteHandlerResult } from
  "@/lib/trader/admin-route-shared";
import {
  createHistoricalRatificationRequestV2,
  HISTORICAL_PROPOSAL_REQUEST_DECISION_V2,
  HISTORICAL_TECHNICAL_PROPOSAL_V2,
  ratifyHistoricalTechnicalProposalV2,
  readHistoricalTechnicalProposalForAdminV2,
} from "./ratification-split-v2";
import { HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2 } from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";

type RatificationAdminPortV2 = Readonly<{
  request(input: Parameters<typeof createHistoricalRatificationRequestV2>[1]):
    ReturnType<typeof createHistoricalRatificationRequestV2>;
  read(input: Parameters<typeof readHistoricalTechnicalProposalForAdminV2>[1]):
    ReturnType<typeof readHistoricalTechnicalProposalForAdminV2>;
  ratify(input: Parameters<typeof ratifyHistoricalTechnicalProposalV2>[1]):
    ReturnType<typeof ratifyHistoricalTechnicalProposalV2>;
}>;

export type HistoricalRatificationAdminHandlerDepsV2 = AdminRouteHandlerDeps & Readonly<{
  env?: NodeJS.ProcessEnv;
  openRatification?(): Readonly<{ service: RatificationAdminPortV2; dispose(): Promise<void> }>;
}>;

const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function productionService() {
  const runtime = createPerRequestPostgresRuntime();
  return Object.freeze({
    service: Object.freeze({
      request: (input: Parameters<typeof createHistoricalRatificationRequestV2>[1]) =>
        createHistoricalRatificationRequestV2(runtime._sql, input),
      read: (input: Parameters<typeof readHistoricalTechnicalProposalForAdminV2>[1]) =>
        readHistoricalTechnicalProposalForAdminV2(runtime._sql, input),
      ratify: (input: Parameters<typeof ratifyHistoricalTechnicalProposalV2>[1]) =>
        ratifyHistoricalTechnicalProposalV2(runtime._sql, input),
    }),
    dispose: async () => { await disposePostgresClientSafely(runtime._sql); },
  });
}

function parseScope(url: URL): Readonly<{ organizationId: string; runId: string;
  releaseSha: string }> | AdminRouteHandlerResult {
  const organizationId = parseOrganizationId(url);
  if (typeof organizationId !== "string") return organizationId;
  const runId = url.searchParams.get("run_id")?.trim();
  const releaseSha = url.searchParams.get("release_sha")?.trim().toLowerCase();
  if (!runId || !releaseSha || !SHA.test(releaseSha)) {
    return adminClientError(400, "HISTORICAL_RATIFICATION_SCOPE_INVALID",
      "Exact run_id and release_sha are required.");
  }
  return Object.freeze({ organizationId, runId, releaseSha });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export async function handleHistoricalRatificationAdminGetV2(
  request: Request,
  deps: HistoricalRatificationAdminHandlerDepsV2,
): Promise<AdminRouteHandlerResult> {
  const scope = parseScope(new URL(request.url));
  if ("status" in scope) return scope;
  let authRuntime; let opened: ReturnType<typeof productionService> | undefined;
  try {
    const auth = await authorizeAdminRoute(deps, scope.organizationId, "admin.audit.read");
    if (!auth.ok) return auth.result;
    authRuntime = auth.runtime;
    opened = deps.openRatification?.() ?? productionService();
    let result: Awaited<ReturnType<RatificationAdminPortV2["read"]>> | null = null;
    try {
      result = await opened.service.read({ ...scope,
        authenticatedOperatorUserId: auth.userId });
    } catch (error) {
      if (!(error instanceof Error) || ![
        "HISTORICAL_RATIFICATION_SPLIT_REFUSED:REQUEST_MISSING",
        "HISTORICAL_RATIFICATION_SPLIT_REFUSED:PROPOSAL_MISSING",
      ].includes(error.message)) {
        throw error;
      }
    }
    const csrfToken = createFhvAdminCsrfToken(
      requireFhvCsrfSecret(deps.env ?? process.env), scope.organizationId, auth.userId,
    );
    return { status: 200, outcome: "success", waiaDbBackend: auth.runtime.kind,
      body: { schemaVersion: "waia.trader.historical_ratification_review_response.v2",
        proposalAvailable: result !== null, ...(result ?? {}) },
      responseHeaders: {
        "Set-Cookie": buildFhvAdminCsrfSetCookieHeader(
          csrfToken, isFhvProductionRuntime(deps.env ?? process.env),
        ),
        [FHV_ADMIN_CSRF_HEADER]: csrfToken,
      } };
  } catch {
    return adminClientError(409, "HISTORICAL_RATIFICATION_REVIEW_UNAVAILABLE",
      "The exact technical proposal is not available for this authenticated actor.");
  } finally { await opened?.dispose(); await deps.disposeRuntimeDb(authRuntime); }
}

export async function handleHistoricalRatificationAdminPostV2(
  request: Request,
  deps: HistoricalRatificationAdminHandlerDepsV2,
): Promise<AdminRouteHandlerResult> {
  const scope = parseScope(new URL(request.url));
  if ("status" in scope) return scope;
  let authRuntime; let opened: ReturnType<typeof productionService> | undefined;
  try {
    const auth = await authorizeAdminRoute(deps, scope.organizationId,
      "admin.trader.operations.mutate");
    if (!auth.ok) return auth.result;
    authRuntime = auth.runtime;
    if (!validateFhvAdminCsrf(request, requireFhvCsrfSecret(deps.env ?? process.env),
      scope.organizationId, auth.userId)) {
      return adminClientError(403, "CSRF_INVALID", "CSRF validation failed.");
    }
    const raw = await request.json().catch(() => null);
    const body = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown> : {};
    if (exactKeys(body, ["action", "cycle_count", "initial_record_index"]) &&
        body.action === HISTORICAL_PROPOSAL_REQUEST_DECISION_V2 &&
        typeof body.initial_record_index === "number" &&
        typeof body.cycle_count === "number") {
      opened = deps.openRatification?.() ?? productionService();
      const result = await opened.service.request({ ...scope,
        authenticatedOperatorUserId: auth.userId,
        initialRecordIndex: body.initial_record_index, cycleCount: body.cycle_count });
      return { status: 201, outcome: "success", waiaDbBackend: auth.runtime.kind,
        body: { schemaVersion: "waia.trader.historical_ratification_request_response.v2",
          id: result.id, contentDigestHex: result.request.contentDigestHex } };
    }
    if (exactKeys(body, ["action", "proposal_content_digest_hex", "proposal_id"]) &&
        body.action === HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2 &&
        typeof body.proposal_id === "string" && UUID.test(body.proposal_id) &&
        typeof body.proposal_content_digest_hex === "string" &&
        DIGEST.test(body.proposal_content_digest_hex)) {
      opened = deps.openRatification?.() ?? productionService();
      const result = await opened.service.ratify({ ...scope,
        proposalId: body.proposal_id,
        proposalContentDigestHex: body.proposal_content_digest_hex,
        authenticatedOperatorUserId: auth.userId,
        humanDecision: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2 });
      return { status: 201, outcome: "success", waiaDbBackend: auth.runtime.kind,
        body: { schemaVersion: "waia.trader.historical_ratification_response.v2",
          id: result.id, contentDigestHex: result.ratification.contentDigestHex } };
    }
    return adminClientError(400, "HISTORICAL_RATIFICATION_REQUEST_INVALID",
      `Use exact ${HISTORICAL_TECHNICAL_PROPOSAL_V2} review and an allowed action.`);
  } catch {
    return adminClientError(409, "HISTORICAL_RATIFICATION_REFUSED",
      "The exact authenticated historical ratification action was refused.");
  } finally { await opened?.dispose(); await deps.disposeRuntimeDb(authRuntime); }
}
