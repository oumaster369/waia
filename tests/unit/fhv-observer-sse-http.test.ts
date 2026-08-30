import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import { createFhvObserverState } from "@/lib/trader/observability/fhv-observer-core";
import { createFhvObserverHttpServer } from "@/lib/trader/observability/fhv-observer-http";
import {
  buildFhvObserverAuthToken,
  sha256Hex,
} from "@/lib/trader/observability/fhv-observer-transport-auth";
import { writeFhvOperatorStatusAtomic } from "@/lib/trader/observability/fhv-status-writer";

const ORG_ID = "00000000-0000-4000-8000-0000000785cc";
const RUN_ID = "dee-785-observer-sse-http";
const SECRET = "dee-785-observer-sse-secret";

describe("DEE-785 observer SSE HTTP transport", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it("authenticates the exact tenant/run and emits resumable named events", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-observer-sse-"));
    const config = {
      runRoot: root,
      runId: RUN_ID,
      organizationId: ORG_ID,
      commandSecret: "command-secret",
      observerTunnelSecret: SECRET,
      bindHost: "127.0.0.1",
      port: 0,
    } as const;
    const state = createFhvObserverState(config);
    writeFhvOperatorStatusAtomic(
      root,
      buildFhvOperatorStatusV1({
        organizationId: ORG_ID,
        runId: RUN_ID,
        phase: "DEVELOPMENT",
        codeSha: "sha",
        artifactDigest: "artifact",
        datasetSeal: "seal",
        datasetDigest: "dataset",
        configurationDigest: "config",
        barsProcessed: 42,
        barsTotal: 100,
      }),
    );
    const server = createFhvObserverHttpServer(config, { state });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const path = `/v1/stream?organization_id=${encodeURIComponent(ORG_ID)}&campaign_run_id=${encodeURIComponent(RUN_ID)}`;
    const unauthorized = await fetch(`http://127.0.0.1:${port}${path}`);
    expect(unauthorized.status).toBe(401);
    const timestampMs = Date.now();
    const token = buildFhvObserverAuthToken(
      {
        method: "GET",
        path,
        organizationId: ORG_ID,
        campaignRunId: RUN_ID,
        timestampMs,
        nonce: "dee-785-sse-nonce-0001",
        bodySha256: sha256Hex(""),
      },
      SECRET,
    );
    const abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { "x-fhv-observer-auth": token, "Last-Event-ID": `${RUN_ID}:41:7` },
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: gate")) {
      const chunk = await reader!.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    abort.abort();
    await reader!.cancel().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(text).toContain("retry: 2000");
    expect(text).toContain("event: campaign.progress");
    expect(text).toContain("event: account.balance");
    expect(text).toContain("event: gate");
    expect(text).toContain(`id: ${RUN_ID}:42:`);
    expect(text).toContain('"source":"HISTORICAL_SIMULATION"');
  });
});
