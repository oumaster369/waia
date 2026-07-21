import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { buildAndWriteFhvOperatorStatus } from "@/lib/trader/observability/fhv-status-writer";
import { createFhvObserverHttpServer } from "@/lib/trader/observability/fhv-observer-http";
import {
  buildFhvObserverAuthToken,
  createFhvObserverAuthNonce,
  FHV_OBSERVER_AUTH_HEADER,
  sha256Hex,
} from "@/lib/trader/observability/fhv-observer-transport-auth";

const ORG = "00000000-0000-4000-8000-0000000416a1";
const RUN_ID = "observer-http-auth-run";
const TUNNEL_SECRET = "fhv-test-tunnel-secret-416";

function authHeader(input: {
  method: string;
  path: string;
  body?: string;
}): Record<string, string> {
  const body = input.body ?? "";
  const payload = {
    method: input.method,
    path: input.path,
    organizationId: ORG,
    campaignRunId: RUN_ID,
    timestampMs: Date.now(),
    nonce: createFhvObserverAuthNonce(),
    bodySha256: sha256Hex(body),
  };
  return {
    [FHV_OBSERVER_AUTH_HEADER]: buildFhvObserverAuthToken(payload, TUNNEL_SECRET),
    "x-fhv-organization-id": ORG,
    "x-fhv-campaign-run-id": RUN_ID,
  };
}

describe("DEE-416 FHV observer HTTP transport auth", () => {
  let root: string;
  let server: ReturnType<typeof createFhvObserverHttpServer>;
  let baseUrl: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires authenticated access for status and rejects missing auth", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-observer-http-"));
    mkdirSync(root, { recursive: true });
    buildAndWriteFhvOperatorStatus(root, {
      organizationId: ORG,
      runId: RUN_ID,
      phase: "validation",
      codeSha: "sha",
      artifactDigest: "artifact",
      datasetSeal: "seal",
      datasetDigest: "digest",
      configurationDigest: "config",
    });

    server = createFhvObserverHttpServer({
      runRoot: root,
      runId: RUN_ID,
      organizationId: ORG,
      commandSecret: "fhv-test-command-secret",
      observerTunnelSecret: TUNNEL_SECRET,
      bindHost: "127.0.0.1",
      port: 0,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const unauthenticated = await fetch(
      `${baseUrl}/v1/status?organization_id=${ORG}&campaign_run_id=${RUN_ID}`,
    );
    expect(unauthenticated.status).toBe(401);

    const path = `/v1/status?organization_id=${encodeURIComponent(ORG)}&campaign_run_id=${encodeURIComponent(RUN_ID)}`;
    const authenticated = await fetch(`${baseUrl}${path}`, {
      headers: authHeader({ method: "GET", path }),
    });
    expect(authenticated.status).toBe(200);
    const body = (await authenticated.json()) as { campaign: { runId: string } };
    expect(body.campaign.runId).toBe(RUN_ID);
  });

  it("rejects malformed JSON command bodies", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-observer-http-json-"));
    mkdirSync(root, { recursive: true });
    server = createFhvObserverHttpServer({
      runRoot: root,
      runId: RUN_ID,
      organizationId: ORG,
      commandSecret: "fhv-test-command-secret",
      observerTunnelSecret: TUNNEL_SECRET,
      bindHost: "127.0.0.1",
      port: 0,
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address unavailable");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const path = `/v1/commands?organization_id=${encodeURIComponent(ORG)}&campaign_run_id=${encodeURIComponent(RUN_ID)}`;
    const bodyText = "{not-json";
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...authHeader({ method: "POST", path, body: bodyText }),
        "Content-Type": "application/json",
      },
      body: bodyText,
    });
    expect(response.status).toBe(400);
  });
});
