import { readFileSync } from "node:fs";

import { readFhvOperatorStatusFromFile } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import type { FhvCommandResultV1 } from "@/lib/trader/observability/fhv-command-ledger";
import type { FhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import type { FhvOperatorStatusV1 } from "@/lib/trader/observability/fhv-operator-status-v1.types";
import {
  buildFhvObserverAuthToken,
  createFhvObserverAuthNonce,
  sha256Hex,
  type FhvObserverAuthPayload,
} from "@/lib/trader/observability/fhv-observer-transport-auth";
import {
  FhvRuntimeConfigError,
  isFhvProductionRuntime,
  isLocalDevelopmentStatusAdapterEnabled,
  requireFhvObserverAccessCredentials,
  requireFhvObserverTunnelBaseUrl,
  requireFhvObserverTunnelSecret,
  requireLocalDevelopmentStatusPath,
} from "@/lib/trader/observability/fhv-runtime-secrets";
import {
  FHV_RESPONSE_BYTE_CAPS,
  FhvRuntimeResponseValidationError,
  parseBoundedJsonResponse,
  validateFhvCommandResultV1Response,
  validateFhvDetailPageV1Response,
  validateFhvOperatorStatusV1Response,
} from "@/lib/trader/observability/fhv-runtime-response-validators";

export type FhvObserverBridgeRequest = Readonly<{
  organizationId: string;
  campaignRunId: string;
  operatorId?: string;
}>;

export type FhvObserverDetailRequest = FhvObserverBridgeRequest &
  Readonly<{
    kind: string;
    cursor: string | null;
    limit: number;
  }>;

export type FhvObserverBridge = Readonly<{
  kind: "LOCAL_DEVELOPMENT_STATUS_ADAPTER" | "AUTHENTICATED_OBSERVER_TUNNEL_ADAPTER";
  fetchStatus(input: FhvObserverBridgeRequest): Promise<FhvOperatorStatusV1>;
  fetchDetail(
    input: FhvObserverDetailRequest,
  ): Promise<{ items: readonly unknown[]; nextCursor: string | null; schemaVersion: string }>;
  forwardCommand(input: {
    organizationId: string;
    campaignRunId: string;
    operatorId: string;
    command: FhvOperatorCommandV1;
  }): Promise<FhvCommandResultV1>;
  openEventStream?(
    input: FhvObserverBridgeRequest & { signal?: AbortSignal; lastEventId?: string | null },
  ): Promise<Response>;
}>;

function readStatusFile(path: string): FhvOperatorStatusV1 {
  return readFhvOperatorStatusFromFile(path);
}

function createLocalDevelopmentStatusAdapter(env: NodeJS.ProcessEnv): FhvObserverBridge {
  if (isFhvProductionRuntime(env)) {
    throw new FhvRuntimeConfigError(
      "FHV_LOCAL_ADAPTER_FORBIDDEN_IN_PRODUCTION",
      "Local file adapter cannot run in production.",
    );
  }
  if (!isLocalDevelopmentStatusAdapterEnabled(env)) {
    throw new FhvRuntimeConfigError(
      "FHV_LOCAL_ADAPTER_NOT_ENABLED",
      "Set FHV_STATUS_ADAPTER=local_file to enable local development status reads.",
    );
  }
  const statusPath = requireLocalDevelopmentStatusPath(env);
  return {
    kind: "LOCAL_DEVELOPMENT_STATUS_ADAPTER",
    async fetchStatus(input) {
      const status = readStatusFile(statusPath);
      return validateFhvOperatorStatusV1Response({
        payload: status,
        organizationId: input.organizationId,
        campaignRunId: input.campaignRunId,
      });
    },
    async fetchDetail() {
      const page = validateFhvDetailPageV1Response({
        payload: { schemaVersion: "fhv-detail-page/v1", items: [], nextCursor: null },
      });
      return { ...page, schemaVersion: "fhv-detail-page/v1" };
    },
    async forwardCommand() {
      throw new FhvRuntimeConfigError(
        "FHV_OBSERVER_UNAVAILABLE",
        "Local development adapter cannot forward commands.",
      );
    },
    async openEventStream() {
      throw new FhvRuntimeConfigError(
        "FHV_OBSERVER_UNAVAILABLE",
        "Local development adapter does not expose a streaming transport.",
      );
    },
  };
}

async function signedObserverFetch(input: {
  env: NodeJS.ProcessEnv;
  method: string;
  path: string;
  organizationId: string;
  campaignRunId: string;
  body?: unknown;
  signal?: AbortSignal;
  streaming?: boolean;
  lastEventId?: string | null;
}): Promise<Response> {
  const secret = requireFhvObserverTunnelSecret(input.env);
  const access = requireFhvObserverAccessCredentials(input.env);
  const baseUrl = requireFhvObserverTunnelBaseUrl(input.env);
  const bodyText = input.body === undefined ? "" : JSON.stringify(input.body);
  const payload: FhvObserverAuthPayload = {
    method: input.method,
    path: input.path,
    organizationId: input.organizationId,
    campaignRunId: input.campaignRunId,
    timestampMs: Date.now(),
    nonce: createFhvObserverAuthNonce(),
    bodySha256: sha256Hex(bodyText),
  };
  const authToken = buildFhvObserverAuthToken(payload, secret);
  const response = await fetch(`${baseUrl}${input.path}`, {
    method: input.method,
    headers: {
      "Content-Type": "application/json",
      "x-fhv-observer-auth": authToken,
      "x-fhv-organization-id": input.organizationId,
      "x-fhv-campaign-run-id": input.campaignRunId,
      "CF-Access-Client-Id": access.clientId,
      "CF-Access-Client-Secret": access.clientSecret,
      ...(input.lastEventId ? { "Last-Event-ID": input.lastEventId } : {}),
    },
    body: bodyText.length > 0 ? bodyText : undefined,
    signal:
      input.signal ??
      (input.streaming
        ? undefined
        : AbortSignal.timeout(Number(input.env.FHV_OBSERVER_TUNNEL_TIMEOUT_MS ?? 10_000))),
  });
  return response;
}

function createAuthenticatedObserverTunnelAdapter(env: NodeJS.ProcessEnv): FhvObserverBridge {
  return {
    kind: "AUTHENTICATED_OBSERVER_TUNNEL_ADAPTER",
    async fetchStatus(input) {
      const path = `/v1/status?organization_id=${encodeURIComponent(input.organizationId)}&campaign_run_id=${encodeURIComponent(input.campaignRunId)}`;
      const response = await signedObserverFetch({
        env,
        method: "GET",
        path,
        organizationId: input.organizationId,
        campaignRunId: input.campaignRunId,
      });
      if (!response.ok) {
        throw new FhvRuntimeConfigError("FHV_OBSERVER_UNAVAILABLE", "Observer status unavailable.");
      }
      const text = await response.text();
      const payload = parseBoundedJsonResponse({
        text,
        maxBytes: FHV_RESPONSE_BYTE_CAPS.status,
        contentType: response.headers.get("content-type"),
      });
      return validateFhvOperatorStatusV1Response({
        payload,
        organizationId: input.organizationId,
        campaignRunId: input.campaignRunId,
      });
    },
    async fetchDetail(input) {
      const path =
        `/v1/detail/${encodeURIComponent(input.kind)}` +
        `?organization_id=${encodeURIComponent(input.organizationId)}` +
        `&campaign_run_id=${encodeURIComponent(input.campaignRunId)}` +
        `&cursor=${encodeURIComponent(input.cursor ?? "")}` +
        `&limit=${input.limit}`;
      const response = await signedObserverFetch({
        env,
        method: "GET",
        path,
        organizationId: input.organizationId,
        campaignRunId: input.campaignRunId,
      });
      if (!response.ok) {
        throw new FhvRuntimeConfigError("FHV_OBSERVER_UNAVAILABLE", "Observer detail unavailable.");
      }
      const text = await response.text();
      const payload = parseBoundedJsonResponse({
        text,
        maxBytes: FHV_RESPONSE_BYTE_CAPS.detail,
        contentType: response.headers.get("content-type"),
      });
      const page = validateFhvDetailPageV1Response({ payload });
      return { ...page, schemaVersion: "fhv-detail-page/v1" };
    },
    async forwardCommand(input) {
      const path = `/v1/commands?organization_id=${encodeURIComponent(input.organizationId)}&campaign_run_id=${encodeURIComponent(input.campaignRunId)}`;
      const response = await signedObserverFetch({
        env,
        method: "POST",
        path,
        organizationId: input.organizationId,
        campaignRunId: input.campaignRunId,
        body: { command: input.command, operatorId: input.operatorId },
      });
      if (!response.ok) {
        throw new FhvRuntimeConfigError(
          "FHV_OBSERVER_UNAVAILABLE",
          "Observer command forwarding failed.",
        );
      }
      const text = await response.text();
      const payload = parseBoundedJsonResponse({
        text,
        maxBytes: FHV_RESPONSE_BYTE_CAPS.commandResult,
        contentType: response.headers.get("content-type"),
      });
      return validateFhvCommandResultV1Response({ payload });
    },
    async openEventStream(input) {
      const path = `/v1/stream?organization_id=${encodeURIComponent(input.organizationId)}&campaign_run_id=${encodeURIComponent(input.campaignRunId)}`;
      const response = await signedObserverFetch({
        env,
        method: "GET",
        path,
        organizationId: input.organizationId,
        campaignRunId: input.campaignRunId,
        signal: input.signal,
        streaming: true,
        lastEventId: input.lastEventId,
      });
      if (!response.ok || !response.body) {
        throw new FhvRuntimeConfigError("FHV_OBSERVER_UNAVAILABLE", "Observer stream unavailable.");
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("text/event-stream")) {
        await response.body.cancel();
        throw new FhvRuntimeConfigError(
          "FHV_OBSERVER_UNAVAILABLE",
          "Observer returned an invalid stream content type.",
        );
      }
      return response;
    },
  };
}

export function resolveFhvObserverBridge(env: NodeJS.ProcessEnv = process.env): FhvObserverBridge {
  if (isFhvProductionRuntime(env)) {
    return createAuthenticatedObserverTunnelAdapter(env);
  }
  if (isLocalDevelopmentStatusAdapterEnabled(env)) {
    return createLocalDevelopmentStatusAdapter(env);
  }
  throw new FhvRuntimeConfigError(
    "FHV_OBSERVER_UNAVAILABLE",
    "No FHV observer bridge configured. Set FHV_STATUS_ADAPTER=local_file for local dev or tunnel vars for production.",
  );
}

export function readBoundStatusFileForTests(path: string): FhvOperatorStatusV1 {
  return JSON.parse(readFileSync(path, "utf8")) as FhvOperatorStatusV1;
}

export { FhvRuntimeResponseValidationError };
