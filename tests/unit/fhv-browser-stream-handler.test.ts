import { describe, expect, it, vi } from "vitest";

import { handleTenantFhvBrowserStream } from "@/lib/trader/observability/fhv-browser-stream-handler";
import type { FhvObserverBridge } from "@/lib/trader/observability/fhv-observer-bridge";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

const USER_ID = "00000000-0000-4000-8000-0000000785bb";
const RUN_ID = "dee-785-browser-stream";

describe("DEE-785 tenant browser stream authorization", () => {
  it("requires a session and trader entitlement", async () => {
    const request = new Request(`https://trader.waia.life/api/stream?campaign_run_id=${RUN_ID}`);
    expect(
      (
        await handleTenantFhvBrowserStream(request, {
          getUserId: async () => null,
          hasTraderAccess: async () => true,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await handleTenantFhvBrowserStream(request, {
          getUserId: async () => USER_ID,
          hasTraderAccess: async () => false,
        })
      ).status,
    ).toBe(403);
  });

  it("derives organization from the authenticated user and ignores caller tenant input", async () => {
    const openEventStream = vi.fn(async () =>
      Promise.resolve(
        new Response("retry: 2000\n\n", {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        }),
      ),
    );
    const bridge: FhvObserverBridge = {
      kind: "AUTHENTICATED_OBSERVER_TUNNEL_ADAPTER",
      fetchStatus: vi.fn(),
      fetchDetail: vi.fn(),
      forwardCommand: vi.fn(),
      openEventStream,
    };
    const request = new Request(
      `https://trader.waia.life/api/stream?campaign_run_id=${RUN_ID}&organization_id=attacker-org`,
      { headers: { "Last-Event-ID": `${RUN_ID}:9:7` } },
    );
    const response = await handleTenantFhvBrowserStream(request, {
      getUserId: async () => USER_ID,
      hasTraderAccess: async () => true,
      resolveBridge: () => bridge,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(openEventStream).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: personalOrganizationIdFromUserId(USER_ID),
        campaignRunId: RUN_ID,
        lastEventId: `${RUN_ID}:9:7`,
      }),
    );
  });

  it("rejects a missing or malformed campaign run id before opening the bridge", async () => {
    const response = await handleTenantFhvBrowserStream(
      new Request("https://trader.waia.life/api/stream?campaign_run_id=bad id"),
      { getUserId: async () => USER_ID, hasTraderAccess: async () => true },
    );
    expect(response.status).toBe(400);
  });
});
