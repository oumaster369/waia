// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  financialHistoryRequestSchema,
  financialHistoryResponseSchema,
  assertFinancialHistoryResponse,
  FINANCIAL_HISTORY_LIMITS,
  type FinancialHistoryRequest,
  type FinancialHistoryResponse,
} from "@/lib/trader/account-observation/financial-history";
import {
  decodeFinancialHistoryCursor,
  encodeFinancialHistoryCursor,
} from "@/lib/trader/account-observation/financial-history-cursor";
import {
  createProjectionRequest,
  verifyProjectionRequest,
  createProjectionResponse,
  verifyProjectionResponse,
  PROJECTION_PATHS,
  type ProjectionTuple,
} from "@/lib/trader/account-observation/projection-protocol";
import { createProjectionClient } from "@/lib/trader/account-observation/projection-client";
import {
  handleAccountObservationGet,
  type ObservationReadDependencies,
} from "@/lib/trader/account-observation/read-handler";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { createProjectionDispatcher } from "@/lib/trader/account-observation/projection-dispatcher";
const now = 1_800_000_000_000;
const binding = {
  organizationId: personalOrganizationIdFromUserId("fixture-user"),
  credentialId: randomUUID(),
  exchangeAccountId: "123",
  credentialRevision: "2",
  configurationRevision: "scope-2",
};
const input: FinancialHistoryRequest = {
  binding,
  pageSize: 2,
  filters: { windowStartMs: null, windowEndMs: null },
  cursor: null,
};
const result: FinancialHistoryResponse = {
  binding,
  htxUid: "456",
  currentFinancialStatus: "NOT_CONFIGURED",
  records: [],
  coverage: [],
  nextCursor: null,
  source: "PERSISTED_COLLECTOR_RECORDS_ONLY",
  providerRequests: 0,
  completeness: "UNKNOWN",
};
const key = new Uint8Array(32).fill(4);
const tuple: ProjectionTuple = {
  audience: "https://observation-reader.waia.life",
  releaseSha: "a".repeat(40),
  epochId: randomUUID(),
  keyId: "fixture",
};
const config = { expectedTuple: tuple, keyBytes: key, clock: () => now };
async function signed(payload: unknown = input) {
  return createProjectionRequest(
    {
      operation: "readFinancialHistory",
      tuple,
      requestId: randomUUID(),
      issuedAtMs: now,
      deadlineMs: now + 4000,
      payload,
    },
    key,
  );
}
const dependencies = (): ObservationReadDependencies => ({
  getUserId: vi.fn(async () => "fixture-user"),
  hasTraderAccess: vi.fn(async () => true),
  hasOrgMembership: vi.fn(async () => true),
  hasOperatorAccess: vi.fn(async () => true),
  isAdminListedOrganization: vi.fn(async () => true),
  resolveActiveBinding: vi.fn(async () => binding),
  readLatest: vi.fn(async () => null),
  readFinancialHistory: vi.fn(async () => result),
});
const req = (extra: Record<string, string | undefined> = {}) =>
  new Request(
    "https://example.test/api/trader/account-observation/financial-history?" +
      new URLSearchParams({
        credentialId: binding.credentialId,
        exchangeAccountId: binding.exchangeAccountId,
        ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)),
      }),
  );

describe("DEE-1248 bounded persisted history", () => {
  it("round trips the exact signed path and rejects substitution, deadline, oversized body and non-schema authority", async () => {
    const raw = await signed();
    expect(raw.path).toBe(PROJECTION_PATHS.readFinancialHistory);
    const verified = await verifyProjectionRequest(raw, config);
    const response = await createProjectionResponse(verified, result, key);
    expect(await verifyProjectionResponse(response, verified, config)).toEqual(result);
    await expect(
      verifyProjectionRequest({ ...raw, path: PROJECTION_PATHS.readLatest }, config),
    ).rejects.toThrow();
    await expect(
      verifyProjectionRequest({ ...raw, path: raw.path + "?x=1" }, config),
    ).rejects.toThrow();
    await expect(
      verifyProjectionResponse(response, verified, { ...config, clock: () => now + 4000 }),
    ).rejects.toThrow();
    await expect(
      verifyProjectionResponse(
        { ...response, body: " ".repeat(FINANCIAL_HISTORY_LIMITS.responseBytes + 1) },
        verified,
        config,
      ),
    ).rejects.toThrow("PROJECTION_BODY_SIZE");
    for (const payload of [
      { ...input, htxUid: "789" },
      { ...input, scopeId: randomUUID() },
      { ...input, pageSize: 101 },
      { ...input, pageSize: 0 },
      { ...input, cursor: "x" },
      { ...input, filters: { windowStartMs: 5, windowEndMs: 5 } },
    ])
      await expect(signed(payload)).rejects.toThrow();
    await expect(
      createProjectionResponse(
        verified,
        { ...result, binding: { ...binding, configurationRevision: "other" } },
        key,
      ),
    ).rejects.toThrow();
  });
  it("authenticates cursor and binds UID, active revisions, filters, page size and age", () => {
    const c = decodeFinancialHistoryCursor(input, "456", now, key);
    const cursor = encodeFinancialHistoryCursor(c, key);
    expect(decodeFinancialHistoryCursor({ ...input, cursor }, "456", now + 1, key)).toEqual(c);
    for (const changed of [
      { ...input, pageSize: 1 },
      { ...input, binding: { ...binding, credentialRevision: "3" } },
      { ...input, binding: { ...binding, credentialId: randomUUID() } },
      { ...input, filters: { windowStartMs: 0, windowEndMs: null } },
    ])
      expect(() => decodeFinancialHistoryCursor({ ...changed, cursor }, "456", now, key)).toThrow();
    expect(() => decodeFinancialHistoryCursor({ ...input, cursor }, "789", now, key)).toThrow();
    expect(() =>
      decodeFinancialHistoryCursor({ ...input, cursor }, "456", now + 3600001, key),
    ).toThrow();
    expect(() =>
      decodeFinancialHistoryCursor(
        { ...input, cursor: cursor.replace(/.$/, (x) => (x === "0" ? "1" : "0")) },
        "456",
        now,
        key,
      ),
    ).toThrow();
  });
  it("returns old revision provenance only inside the same UID and credential lineage, with raw decimals", () => {
    const provenance = {
      binding: { ...binding, credentialRevision: "1", configurationRevision: "prior" },
      observationId: randomUUID(),
      scopeId: randomUUID(),
      windowStartMs: 0,
      windowEndMs: 10,
      validFromMs: 10,
      validUntilMs: 20,
      collectionCompletedAtMs: 11,
    };
    const record = {
      htxUid: "456",
      provenance,
      bill: {
        id: "1",
        contractCode: "",
        marginMode: "cross",
        currency: "USDT",
        type: "999",
        category: "UNKNOWN",
        amount: "-0.00100",
        createdTimeMs: 1,
      },
    };
    expect(
      financialHistoryResponseSchema.parse({ ...result, records: [record] }).records[0].bill.amount,
    ).toBe("-0.00100");
    expect(() =>
      financialHistoryResponseSchema.parse({ ...result, records: [{ ...record, htxUid: "789" }] }),
    ).toThrow();
    expect(() =>
      financialHistoryResponseSchema.parse({
        ...result,
        records: [
          {
            ...record,
            provenance: { ...provenance, binding: { ...binding, credentialId: randomUUID() } },
          },
        ],
      }),
    ).toThrow();
    const valid = financialHistoryResponseSchema.parse({ ...result, records: [record] });
    expect(() =>
      assertFinancialHistoryResponse(
        { ...input, filters: { windowStartMs: 2, windowEndMs: null } },
        valid,
      ),
    ).toThrow();
    expect(() =>
      financialHistoryRequestSchema.parse({ ...input, binding: { ...binding, htxUid: "456" } }),
    ).toThrow();
  });
  it("uses the signed client without fallback and caps the decoded history response at one MiB", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(tuple.audience + PROJECTION_PATHS.readFinancialHistory);
      const r = await verifyProjectionRequest(
        {
          method: init!.method,
          path: PROJECTION_PATHS.readFinancialHistory,
          body: init!.body,
          headers: [
            [
              "x-waia-projection-signature",
              new Headers(init!.headers).get("x-waia-projection-signature"),
            ],
          ],
        },
        config,
      );
      const response = await createProjectionResponse(r, result, key);
      return new Response(response.body, {
        headers: {
          "content-type": "application/json",
          "x-waia-projection-signature": response.headers[0][1],
        },
      });
    });
    const client = createProjectionClient({
      fetch: fetchMock as typeof fetch,
      clock: () => now,
      tuple,
      keyBytes: key,
      accessClientId: "fixture",
      accessClientSecret: "synthetic",
      deadlineMs: now + 4000,
    });
    try {
      expect(await client.readFinancialHistory(input)).toEqual(result);
      fetchMock.mockImplementationOnce(
        async () =>
          new Response("x".repeat(FINANCIAL_HISTORY_LIMITS.responseBytes + 1), {
            headers: {
              "content-type": "application/json",
              "x-waia-projection-signature": "a".repeat(64),
            },
          }),
      );
      await expect(client.readFinancialHistory(input)).rejects.toThrow("PROJECTION_UNAVAILABLE");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      client.dispose();
    }
  });
  it("dispatches only the dedicated history port and rejects a replay", async () => {
    let wall = now - 11000,
      mono = 0;
    const reader = {
      resolveActiveBinding: vi.fn(async () => binding),
      readLatest: vi.fn(async () => null),
      readFinancialHistory: vi.fn(async () => result),
    };
    const dispatcher = createProjectionDispatcher({
      tuple,
      keyBytes: key,
      reader,
      wallClock: () => wall,
      monotonicClock: () => mono,
    });
    wall = now;
    mono = 11000;
    const raw = await signed(),
      lease = dispatcher.acquire();
    try {
      const response = await lease.run(raw);
      expect(response.status).toBe(200);
      expect(reader.readFinancialHistory).toHaveBeenCalledWith(input);
      expect(reader.readLatest).not.toHaveBeenCalled();
      const replay = dispatcher.acquire();
      try {
        await expect(replay.run(raw)).rejects.toThrow();
      } finally {
        replay.release();
      }
    } finally {
      lease.release();
      dispatcher.stop();
    }
  });
  it("derives active revisions and tenant org, rechecks auth/binding and distinguishes missing from empty", async () => {
    const deps = dependencies();
    const response = await handleAccountObservationGet(req(), "tenant", deps, "financial-history");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(result);
    expect(deps.readLatest).not.toHaveBeenCalled();
    expect(deps.readFinancialHistory).toHaveBeenCalledWith(
      { ...input, pageSize: 100 },
      expect.any(AbortSignal),
    );
    expect(deps.resolveActiveBinding).toHaveBeenCalledTimes(2);
    const missing = dependencies();
    vi.mocked(missing.readFinancialHistory!).mockResolvedValue(null);
    expect(
      (await handleAccountObservationGet(req(), "tenant", missing, "financial-history")).status,
    ).toBe(204);
    const changed = dependencies();
    vi.mocked(changed.resolveActiveBinding)
      .mockResolvedValueOnce(binding)
      .mockResolvedValueOnce({ ...binding, credentialRevision: "3" });
    expect(
      (await handleAccountObservationGet(req(), "tenant", changed, "financial-history")).status,
    ).toBe(403);
  });
  it.each([
    { htxUid: "1" },
    { credentialRevision: "1" },
    { organizationId: randomUUID() },
    { scopeId: randomUUID() },
    { pageSize: "101" },
    { windowStartMs: "-1" },
    { windowEndMs: "" },
  ])("rejects caller authority or invalid query %j", async (extra) => {
    const deps = dependencies();
    expect(
      (await handleAccountObservationGet(req(extra), "tenant", deps, "financial-history")).status,
    ).toBe(400);
    expect(deps.readFinancialHistory).not.toHaveBeenCalled();
  });
  it("never reads history on missing session, denied entitlement/membership, or admin-list denial", async () => {
    for (const denied of ["getUserId", "hasTraderAccess", "hasOrgMembership"] as const) {
      const deps = dependencies();
      if (denied === "getUserId") vi.mocked(deps.getUserId).mockResolvedValue(null);
      else vi.mocked(deps[denied]).mockResolvedValue(false);
      expect(
        (await handleAccountObservationGet(req(), "tenant", deps, "financial-history")).status,
      ).toBe(denied === "getUserId" ? 401 : 403);
      expect(deps.readFinancialHistory).not.toHaveBeenCalled();
    }
    const deps = dependencies();
    vi.mocked(deps.isAdminListedOrganization).mockResolvedValue(false);
    expect(
      (
        await handleAccountObservationGet(
          req({ organizationId: binding.organizationId }),
          "admin",
          deps,
          "financial-history",
        )
      ).status,
    ).toBe(403);
    expect(deps.readFinancialHistory).not.toHaveBeenCalled();
  });
});
