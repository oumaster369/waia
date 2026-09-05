import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), csrf: vi.fn(), disposeAuth: vi.fn() }));
vi.mock("@/lib/trader/admin-route-shared", async (original) => {
  const actual = await original<typeof import("@/lib/trader/admin-route-shared")>();
  return { ...actual, authorizeAdminRoute: mocks.authorize };
});
vi.mock("@/lib/trader/fhv-admin-csrf", async (original) => {
  const actual = await original<typeof import("@/lib/trader/fhv-admin-csrf")>();
  return { ...actual, validateFhvAdminCsrf: mocks.csrf,
    createFhvAdminCsrfToken: () => "csrf-token" };
});
vi.mock("@/lib/trader/observability/fhv-runtime-secrets", async (original) => {
  const actual = await original<
    typeof import("@/lib/trader/observability/fhv-runtime-secrets")
  >();
  return { ...actual, requireFhvCsrfSecret: () => "csrf-secret" };
});

import {
  handleHistoricalRatificationAdminGetV2,
  handleHistoricalRatificationAdminPostV2,
} from "@/lib/trader/historical-simulation-v2/ratification-admin-handler-v2";
import {
  HISTORICAL_PROPOSAL_REQUEST_DECISION_V2,
} from "@/lib/trader/historical-simulation-v2/ratification-split-v2";
import { HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2 } from
  "@/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2";

const organizationId = "11111111-1111-4111-8111-111111111111";
const operatorId = "22222222-2222-4222-8222-222222222222";
const proposalId = "33333333-3333-4333-8333-333333333333";
const releaseSha = "a".repeat(40);
const proposalDigest = "b".repeat(64);
const baseUrl = `https://waia.test/api?organization_id=${organizationId}` +
  `&run_id=run-1&release_sha=${releaseSha}`;

describe("Historical V2 split Admin ratification", () => {
  it.each([handleHistoricalRatificationAdminGetV2, handleHistoricalRatificationAdminPostV2])(
    "disposes the authenticated runtime on permission denial", async (handler) => {
      const runtime = { kind: "postgres" };
      mocks.authorize.mockResolvedValueOnce({ ok: false, runtime,
        result: { status: 403, body: {}, outcome: "client_error" } });
      const openRatification = vi.fn();
      const result = await handler(new Request(baseUrl), {
        getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
        openRatification,
      });
      expect(result.status).toBe(403);
      expect(mocks.disposeAuth).toHaveBeenCalledWith(runtime);
      expect(openRatification).not.toHaveBeenCalled();
    });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ ok: true, userId: operatorId,
      runtime: { kind: "postgres" } });
    mocks.csrf.mockReturnValue(true);
  });

  it("derives proposal-request actor only from the authenticated Admin session", async () => {
    const request = vi.fn(async (input) => ({ id: "request-1", request: {
      contentDigestHex: "c".repeat(64), operatorUserId: input.authenticatedOperatorUserId,
    } }));
    const dispose = vi.fn(async () => undefined);
    const result = await handleHistoricalRatificationAdminPostV2(new Request(baseUrl, {
      method: "POST", body: JSON.stringify({ action: HISTORICAL_PROPOSAL_REQUEST_DECISION_V2,
        initial_record_index: 525600, cycle_count: 35 }),
    }), { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
      openRatification: () => ({ service: { request, read: vi.fn(), ratify: vi.fn() } as never,
        dispose }) });
    expect(result.status).toBe(201);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      authenticatedOperatorUserId: operatorId, runId: "run-1", releaseSha,
      initialRecordIndex: 525600, cycleCount: 35,
    }));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects caller-supplied actor and requires exact proposal identity for ratification", async () => {
    const openRatification = vi.fn();
    const injected = await handleHistoricalRatificationAdminPostV2(new Request(baseUrl, {
      method: "POST", body: JSON.stringify({
        action: HISTORICAL_PROPOSAL_REQUEST_DECISION_V2, operator_user_id: operatorId,
      }),
    }), { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
      openRatification });
    expect(injected.status).toBe(400);
    expect(openRatification).not.toHaveBeenCalled();

    const ratify = vi.fn(async (input) => ({ id: "approval-1", ratification: {
      contentDigestHex: "d".repeat(64), operatorUserId: input.authenticatedOperatorUserId,
    } }));
    const approved = await handleHistoricalRatificationAdminPostV2(new Request(baseUrl, {
      method: "POST", body: JSON.stringify({ action: HISTORICAL_FOUR_SURFACE_HUMAN_DECISION_V2,
        proposal_id: proposalId, proposal_content_digest_hex: proposalDigest }),
    }), { getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
      openRatification: () => ({ service: { request: vi.fn(), read: vi.fn(), ratify } as never,
        dispose: vi.fn(async () => undefined) }) });
    expect(approved.status).toBe(201);
    expect(ratify).toHaveBeenCalledWith(expect.objectContaining({
      proposalId, proposalContentDigestHex: proposalDigest,
      authenticatedOperatorUserId: operatorId,
    }));
  });

  it("exposes the digest-sealed proposal only after authenticated audit authorization", async () => {
    const read = vi.fn(async () => ({ requestId: "request-1", proposalId,
      proposal: { contentDigestHex: proposalDigest }, ratified: false }));
    const result = await handleHistoricalRatificationAdminGetV2(new Request(baseUrl), {
      getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
      openRatification: () => ({ service: { request: vi.fn(), read, ratify: vi.fn() } as never,
        dispose: vi.fn(async () => undefined) }),
    });
    expect(result.status).toBe(200);
    expect(result.responseHeaders?.["x-fhv-csrf-token"]).toBe("csrf-token");
    expect(result.body).toMatchObject({ proposalAvailable: true, proposalId });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), organizationId,
      "admin.audit.read");
    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      authenticatedOperatorUserId: operatorId,
    }));
  });

  it("bootstraps the CSRF ceremony before an execution-host proposal exists", async () => {
    const read = vi.fn(async () => {
      throw new Error("HISTORICAL_RATIFICATION_SPLIT_REFUSED:PROPOSAL_MISSING");
    });
    const result = await handleHistoricalRatificationAdminGetV2(new Request(baseUrl), {
      getUserId: vi.fn(), getRuntimeDb: vi.fn(), disposeRuntimeDb: mocks.disposeAuth,
      openRatification: () => ({ service: { request: vi.fn(), read, ratify: vi.fn() } as never,
        dispose: vi.fn(async () => undefined) }),
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ proposalAvailable: false });
    expect(result.responseHeaders?.["x-fhv-csrf-token"]).toBe("csrf-token");
  });
});
