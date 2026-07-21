import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  adminActor,
  adminClientError,
  adminSuccess,
  authorizeAdminRoute,
  parseOrganizationId,
  type AdminRouteHandlerDeps,
  type AdminRouteHandlerResult,
} from "@/lib/trader/admin-route-shared";
import { createFhvAdminCsrfToken, validateFhvAdminCsrf } from "@/lib/trader/fhv-admin-csrf";
import { checkFhvAdminCommandRateLimit } from "@/lib/trader/fhv-admin-rate-limit";
import {
  redactHoldoutPayload,
  assertHoldoutGateClosedExposure,
} from "@/lib/trader/observability/fhv-holdout-redaction";
import {
  signFhvOperatorCommandV1,
  type FhvOperatorCommandV1,
} from "@/lib/trader/observability/fhv-operator-command-v1";
import { readFhvOperatorStatusFromFile } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

function resolveFhvStatusPath(): string | null {
  return process.env.FHV_OPERATOR_STATUS_PATH?.trim() || null;
}

function resolveFhvCommandSecret(): string {
  return process.env.FHV_OPERATOR_COMMAND_SECRET?.trim() || "fhv-dev-command-secret";
}

function resolveFhvCsrfSecret(): string {
  return process.env.FHV_ADMIN_CSRF_SECRET?.trim() || "fhv-dev-csrf-secret";
}

function loadFhvStatusForOrg(organizationId: string): FhvOperatorStatusV1 | null {
  const path = resolveFhvStatusPath();
  if (!path) {
    return null;
  }
  const status = readFhvOperatorStatusFromFile(path);
  if (!status) {
    return null;
  }
  void organizationId;
  return status;
}

export async function handleAdminFhvOperationsStatusGet(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    requireOrgContext(orgParsed);

    const status = loadFhvStatusForOrg(orgParsed);
    if (!status) {
      return adminClientError(404, "FHV_STATUS_UNAVAILABLE", "FHV operator status unavailable.");
    }

    const redacted = redactHoldoutPayload(status as unknown as Record<string, unknown>, false);
    assertHoldoutGateClosedExposure(redacted);

    return adminSuccess(
      {
        status: redacted,
        csrfToken: createFhvAdminCsrfToken(resolveFhvCsrfSecret()),
      },
      runtime.kind,
    );
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
};

function parseFhvCommandBody(raw: unknown): FhvCommandBody | AdminRouteHandlerResult {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return adminClientError(400, "INVALID_BODY", "JSON body required.");
  }
  return raw as FhvCommandBody;
}

export async function handleAdminFhvOperationsCommandPost(
  request: Request,
  deps: AdminRouteHandlerDeps,
): Promise<AdminRouteHandlerResult> {
  const url = new URL(request.url);
  const orgParsed = parseOrganizationId(url);
  if (typeof orgParsed !== "string") {
    return orgParsed;
  }

  if (!validateFhvAdminCsrf(request, resolveFhvCsrfSecret())) {
    return adminClientError(403, "CSRF_INVALID", "CSRF validation failed.");
  }

  let runtime;
  try {
    const auth = await authorizeAdminRoute(deps, orgParsed, "admin.audit.read");
    if (!auth.ok) {
      return auth.result;
    }
    runtime = auth.runtime;
    requireOrgContext(orgParsed);

    const rate = checkFhvAdminCommandRateLimit(auth.userId);
    if (!rate.allowed) {
      return adminClientError(429, "RATE_LIMITED", "Command rate limit exceeded.");
    }

    const bodyParsed = parseFhvCommandBody(await request.json());
    if ("status" in bodyParsed) {
      return bodyParsed;
    }

    const status = loadFhvStatusForOrg(orgParsed);
    if (!status) {
      return adminClientError(404, "FHV_STATUS_UNAVAILABLE", "FHV operator status unavailable.");
    }

    const action = bodyParsed.action;
    const reason = bodyParsed.reason?.trim();
    if (!action || !reason) {
      return adminClientError(400, "COMMAND_INVALID", "action and reason required.");
    }

    const issuedAtUtc = new Date().toISOString();
    const expiresAtUtc = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const unsigned = {
      schemaVersion: "fhv-operator-command/v1" as const,
      commandId: crypto.randomUUID(),
      campaignRunId: bodyParsed.campaign_run_id ?? status.campaign.runId,
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
      confirmationPhraseClass: "NONE" as const,
    };

    const command = signFhvOperatorCommandV1(unsigned, resolveFhvCommandSecret());

    const observerUrl = process.env.FHV_OBSERVER_COMMAND_URL?.trim();
    if (observerUrl) {
      const response = await fetch(observerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const result = (await response.json()) as Record<string, unknown>;
      return adminSuccess({ commandResult: result, actor: adminActor(auth.userId) }, runtime.kind);
    }

    return adminSuccess(
      {
        command,
        forwarded: false,
        message: "Signed command prepared; observer tunnel not configured.",
        actor: adminActor(auth.userId),
      },
      runtime.kind,
    );
  } catch (err) {
    return adminClientError(400, "COMMAND_FAILED", err instanceof Error ? err.message : "Failed.");
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
}

export function readFhvStatusFromPathForTests(path: string): FhvOperatorStatusV1 {
  return JSON.parse(readFileSync(path, "utf8")) as FhvOperatorStatusV1;
}
