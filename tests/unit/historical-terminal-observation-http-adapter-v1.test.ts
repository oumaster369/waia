import { describe, expect, it, vi } from "vitest";

import {
  createHistoricalTerminalAuthenticatedHttpAdapterV1,
  HistoricalTerminalObservationHttpRefusalV1,
} from "@/lib/trader/historical-simulation-v2/historical-terminal-observation-http-adapter-v1";
import {
  historicalTerminalAdminObservationUrlV1,
  historicalTerminalTenantObservationUrlV1,
} from "@/lib/trader/historical-simulation-v2/historical-terminal-launch-verifier-v1";
import type { HistoricalObservableProjectionV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-v2";

const origin = "https://waia.example";
const organizationId = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const runId = "historical-run-1012";
const accountId = "durable-account";
const lifecycleDigest = "a".repeat(64);
const ledgerDigest = "b".repeat(64);
const checkpointDigest = "c".repeat(64);

function projection(
  overrides: Partial<HistoricalObservableProjectionV2> = {},
): HistoricalObservableProjectionV2 {
  const cycle = {
    accountId,
    cycleSequence: 1,
    cycleId: "cycle-1",
    symbol: "BTCUSDT",
    partition: "WALK_FORWARD" as const,
    replayBarClosedAtUtc: "2026-09-15T09:00:00.000Z",
    cash: "100.00000000",
    equity: "101.00000000",
    netPnl: "1.00000000",
    grossRealizedPnl: "1.00000000",
    netRealizedPnl: "1.00000000",
    netUnrealizedPnl: "0.00000000",
    buyAndHoldGrossEquity: "99.00000000",
    strategyMinusBuyAndHoldGross: "2.00000000",
    buyAndHoldConvention: "GROSS_MARK_TO_MARKET_NO_FEES" as const,
    openPositionsCount: 0,
    decisionsCount: 2,
    riskVetoCount: 0,
    ordersCount: 1,
    fillsCount: 1,
    pendingModeledOrders: [],
    lastForecast: { authority: "retained" },
    lastDecision: null,
    lastPortfolio: null,
    lastRisk: { verdict: "PASS" },
    lastExecution: { status: "FILLED" },
    lastAccounting: { equity: "101.00000000" },
    lastGuardian: null,
    lastLearning: null,
    observedExecutionEffects: [],
    modeledRealityArtifacts: [],
    knowledgeArtifacts: [],
    stages: ["FORECAST", "DECISION"],
    snapshots: ["snapshot-1"],
    checkpoint: {
      committedCycleSequence: 1,
      nextRecordIndex: 2,
      nextCycleSequence: 2,
      contentDigestHex: checkpointDigest,
    },
    ledgerHeadContentDigestHex: ledgerDigest,
  };
  return {
    schemaVersion: "waia.trader.historical_observable_read_model.v2",
    mode: "HISTORICAL_SIMULATION",
    capitalEligible: false,
    organizationId,
    runId,
    eventId: "event-1",
    observedAt: "2026-09-15T09:01:00.000Z",
    lifecycle: {
      phase: "RUNNING",
      qualifiedTotalCycles: 3,
      committedCycles: 2,
      remainingCycles: 1,
      progressBps: 6666,
      nextCycleSequence: 2,
      latestCommittedCycleId: "cycle-1",
      observedAt: "2026-09-15T09:01:00.000Z",
      errorCode: null,
      contentDigestHex: lifecycleDigest,
    },
    accounts: [{ ...cycle, history: [cycle] }],
    aggregate: {
      accountCount: 1,
      equity: "101.00000000",
      cash: "100.00000000",
      netPnl: "1.00000000",
      buyAndHoldGrossEquity: "99.00000000",
      strategyMinusBuyAndHoldGross: "2.00000000",
      cycles: 2,
      decisions: 2,
      riskVetoes: 0,
      orders: 1,
      fills: 1,
      processedRecords: 2,
      latestCycleSequence: 1,
      qualifiedTotalCycles: 3,
      committedCycles: 2,
      progressBps: 6666,
      runPhase: "RUNNING",
    },
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...init.headers },
  });
}

function adapter(fetchImpl: typeof fetch) {
  return createHistoricalTerminalAuthenticatedHttpAdapterV1({
    origin,
    scope: { organizationId, runId, accountId },
    fetchImpl,
  });
}

function refusalCode(error: unknown): string | undefined {
  return error instanceof HistoricalTerminalObservationHttpRefusalV1 ? error.code : undefined;
}

describe("DEE-1012 authenticated Historical V2 HTTP adapter", () => {
  it("uses only the real polling URLs and caller-supplied cookies", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(projection({ eventId: "admin-event" })))
      .mockResolvedValueOnce(jsonResponse(projection({ eventId: "tenant-event" })));
    const http = adapter(fetchImpl);

    const admin = await http.fetch({
      url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
      cookie: "__Host-waia-admin=real-admin-session",
      role: "admin",
    });
    const tenant = await http.fetch({
      url: historicalTerminalTenantObservationUrlV1(runId, accountId),
      cookie: "__Host-waia-tenant=real-tenant-session",
      role: "tenant",
    });

    expect(admin.authenticated).toBe(true);
    expect(tenant.authenticated).toBe(true);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      new URL(
        `/api/trader/admin/historical-v2/stream?organization_id=${organizationId}&run_id=${runId}&transport=poll`,
        origin,
      ),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        mode: "same-origin",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          Cookie: "__Host-waia-admin=real-admin-session",
        },
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL(
        `/api/trader/historical-v2/stream?run_id=${runId}&account_id=${accountId}&transport=poll`,
        origin,
      ),
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          Cookie: "__Host-waia-tenant=real-tenant-session",
        },
      }),
    );
    expect(admin.body?.lifecycle?.contentDigestHex).toBe(lifecycleDigest);
    expect(admin.body?.accounts[0]?.ledgerHeadContentDigestHex).toBe(ledgerDigest);
    expect(admin.body?.accounts[0]?.cycleId).toBe("cycle-1");
    expect(admin.body?.accounts[0]?.cycleSequence).toBe(1);
  });

  it("refuses cross-origin, non-HTTPS, malformed scope, and fixture configuration", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const http = adapter(fetchImpl);
    await expect(
      http.fetch({
        url: `https://evil.example${historicalTerminalAdminObservationUrlV1(organizationId, runId)}`,
        cookie: "session=real",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "ORIGIN" });
    expect(() =>
      createHistoricalTerminalAuthenticatedHttpAdapterV1({
        origin: "http://waia.example",
        scope: { organizationId, runId, accountId },
        fetchImpl,
      }),
    ).toThrow("HISTORICAL_TERMINAL_HTTP_REFUSED:ORIGIN");
    await expect(
      http.fetch({
        url: `/api/trader/admin/historical-v2/stream?organization_id=${organizationId}&run_id=${runId}`,
        cookie: "session=real",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "REQUEST_SCOPE" });
    expect(() =>
      createHistoricalTerminalAuthenticatedHttpAdapterV1({
        origin,
        scope: { organizationId, runId: "e2e-observation-only", accountId },
        fetchImpl,
      }),
    ).toThrow("HISTORICAL_TERMINAL_HTTP_REFUSED:CONFIG");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on redirects and unexpected statuses", async () => {
    const redirected = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: `${origin}/login` },
        }),
      ),
    );
    await expect(
      redirected.fetch({
        url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
        cookie: "session=real",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "REDIRECT" });

    const failed = adapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "closed" }, { status: 500 })),
    );
    await expect(
      failed.fetch({
        url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
        cookie: "session=real",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "HTTP_STATUS" });
  });

  it.each([401, 403])("returns unauthenticated once for HTTP %s without retry", async (status) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "not exposed" }, { status }));
    const result = await adapter(fetchImpl).fetch({
      url: historicalTerminalTenantObservationUrlV1(runId, accountId),
      cookie: "session=real",
      role: "tenant",
    });
    expect(result).toEqual({ status, authenticated: false, body: null });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("refuses wrong content type, malformed JSON, malformed schema, and oversized bodies", async () => {
    const request = {
      url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
      cookie: "session=real",
      role: "admin" as const,
    };
    await expect(
      adapter(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("{}", { headers: { "Content-Type": "text/html" } })),
      ).fetch(request),
    ).rejects.toMatchObject({ code: "CONTENT_TYPE" });
    await expect(
      adapter(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("{", { headers: { "Content-Type": "application/json" } }),
          ),
      ).fetch(request),
    ).rejects.toMatchObject({ code: "PAYLOAD_JSON" });
    await expect(
      adapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ mode: "HISTORICAL_SIMULATION" })),
      ).fetch(request),
    ).rejects.toMatchObject({ code: "PAYLOAD_SCHEMA" });
    const bounded = createHistoricalTerminalAuthenticatedHttpAdapterV1({
      origin,
      scope: { organizationId, runId, accountId },
      maxResponseBytes: 64,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(projection())),
    });
    await expect(bounded.fetch(request)).rejects.toMatchObject({ code: "PAYLOAD_SIZE" });
  });

  it("refuses wrong admin organization/run and wrong tenant organization/run/account", async () => {
    const adminRequest = {
      url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
      cookie: "session=real",
      role: "admin" as const,
    };
    const tenantRequest = {
      url: historicalTerminalTenantObservationUrlV1(runId, accountId),
      cookie: "session=real",
      role: "tenant" as const,
    };
    for (const body of [
      projection({ organizationId: "11111111-1111-4111-8111-111111111111" }),
      projection({ runId: "other-run" }),
    ]) {
      await expect(
        adapter(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body))).fetch(adminRequest),
      ).rejects.toMatchObject({ code: "RESPONSE_SCOPE" });
    }
    for (const body of [
      projection({ organizationId: "11111111-1111-4111-8111-111111111111" }),
      projection({ runId: "other-run" }),
      projection({
        accounts: [
          {
            ...projection().accounts[0]!,
            accountId: "other-account",
            history: projection().accounts[0]!.history.map((cycle) => ({
              ...cycle,
              accountId: "other-account",
            })),
          },
        ],
      }),
    ]) {
      await expect(
        adapter(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body))).fetch(tenantRequest),
      ).rejects.toMatchObject({ code: "RESPONSE_SCOPE" });
    }
  });

  it("accepts the canonical 10,000-cycle observation boundary", async () => {
    const base = projection();
    const { history: _history, ...cycle } = base.accounts[0]!;
    void _history;
    const history = Array.from({ length: 10_000 }, (_value, cycleSequence) => ({
      ...cycle,
      cycleSequence,
      cycleId: `cycle-${cycleSequence}`,
      checkpoint: {
        ...cycle.checkpoint!,
        committedCycleSequence: cycleSequence,
        nextCycleSequence: cycleSequence + 1,
      },
    }));
    const latest = history.at(-1)!;
    const body = projection({
      lifecycle: {
        ...base.lifecycle!,
        phase: "COMPLETED",
        qualifiedTotalCycles: 10_000,
        committedCycles: 10_000,
        remainingCycles: 0,
        progressBps: 10_000,
        nextCycleSequence: 10_000,
        latestCommittedCycleId: latest.cycleId,
      },
      accounts: [{ ...latest, history }],
      aggregate: {
        ...base.aggregate,
        cycles: 10_000,
        processedRecords: 10_000,
        latestCycleSequence: 9_999,
        qualifiedTotalCycles: 10_000,
        committedCycles: 10_000,
        progressBps: 10_000,
        runPhase: "COMPLETED",
      },
    });
    const result = await adapter(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body))).fetch(
      {
        url: historicalTerminalTenantObservationUrlV1(runId, accountId),
        cookie: "session=real",
        role: "tenant",
      },
    );
    expect(result.body?.accounts[0]?.history).toHaveLength(10_000);
    expect(result.body?.accounts[0]?.cycleId).toBe("cycle-9999");
  });

  it("aborts and refuses a stalled authenticated request at the configured timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const http = createHistoricalTerminalAuthenticatedHttpAdapterV1({
      origin,
      scope: { organizationId, runId, accountId },
      fetchImpl,
      timeoutMs: 10,
    });
    await expect(
      http.fetch({
        url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
        cookie: "session=real",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(true);
  });

  it("aborts and refuses when a valid response body stalls", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const http = createHistoricalTerminalAuthenticatedHttpAdapterV1({
      origin,
      scope: { organizationId, runId, accountId },
      timeoutMs: 10,
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(stream, { headers: { "Content-Type": "application/json" } }),
        ),
    });
    await expect(
      http.fetch({
        url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
        cookie: "session=real",
        role: "admin",
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("never includes caller credentials in errors or console output", async () => {
    const secret = "__Host-waia-session=never-print-this-token";
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`network failed: ${secret}`));
    let caught: unknown;
    try {
      await adapter(fetchImpl).fetch({
        url: historicalTerminalAdminObservationUrlV1(organizationId, runId),
        cookie: secret,
        role: "admin",
      });
    } catch (error) {
      caught = error;
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(refusalCode(caught)).toBe("NETWORK");
    expect(String(caught)).not.toContain(secret);
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
  });
});
