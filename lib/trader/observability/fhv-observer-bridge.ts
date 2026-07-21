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
  requireFhvObserverTunnelBaseUrl,
  requireFhvObserverTunnelSecret,
  requireLocalDevelopmentStatusPath,
} from "@/lib/trader/observability/fhv-runtime-secrets";
import { assertFhvStatusOrganizationBinding } from "@/lib/trader/observability/fhv-telemetry-probes";

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
  ): Promise<{ items: readonly unknown[]; nextCursor: string | null }>;
  forwardCommand(input: {
    organizationId: string;
    campaignRunId: string;
    operatorId: string;
    command: FhvOperatorCommandV1;
  }): Promise<FhvCommandResultV1>;
}>;

const MAX_RESPONSE_BYTES = 256 * 1024;

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
      assertFhvStatusOrganizationBinding(status, input.organizationId, input.campaignRunId);
      return status;
    },
    async fetchDetail() {
      return { items: [], nextCursor: null };
    },
    async forwardCommand() {
      throw new FhvRuntimeConfigError(
        "FHV_OBSERVER_UNAVAILABLE",
        "Local development adapter cannot forward commands.",
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
}): Promise<Response> {
  const secret = requireFhvObserverTunnelSecret(input.env);
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
    },
    body: bodyText.length > 0 ? bodyText : undefined,
    signal: AbortSignal.timeout(Number(input.env.FHV_OBSERVER_TUNNEL_TIMEOUT_MS ?? 10_000)),
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
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new FhvRuntimeConfigError(
          "FHV_OBSERVER_RESPONSE_TOO_LARGE",
          "Observer response too large.",
        );
      }
      const status = JSON.parse(text) as FhvOperatorStatusV1;
      assertFhvStatusOrganizationBinding(status, input.organizationId, input.campaignRunId);
      return status;
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
      return (await response.json()) as { items: readonly unknown[]; nextCursor: string | null };
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
      return (await response.json()) as FhvCommandResultV1;
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
