import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { snapshotAgeText, TraderWorkspace } from "@/components/trader/trader-workspace";
import { HistoricalV2ObservationDashboard } from "@/components/trader/historical-v2-observation-dashboard";
import { ACCOUNT_OBSERVATION_FIRST_TICK_COPY } from "@/lib/trader/account-observation/cabinet-view";

const { mockSearchParams } = vi.hoisted(() => ({ mockSearchParams: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockSearchParams.delete("campaign_run_id");
  mockSearchParams.delete("account_id");
});

describe("Trader Dashboard V2", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");

  it("reports factual age without an unversioned freshness category", () => {
    expect(snapshotAgeText("2026-08-28T11:50:00.000Z", now)).toBe("Observed 10 minutes ago");
  });

  it("reports an old snapshot by factual age only", () => {
    expect(snapshotAgeText("2026-08-28T10:00:00.000Z", now)).toBe("Observed 120 minutes ago");
  });

  it("does not fabricate age for missing, invalid, or future timestamps", () => {
    expect(snapshotAgeText(undefined, now)).toBeNull();
    expect(snapshotAgeText("not-a-timestamp", now)).toBeNull();
    expect(snapshotAgeText("2026-08-28T12:00:01.000Z", now)).toBeNull();
  });

  it("renders the live cabinet without manual sync, invented PnL, or live controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/exchange-credentials") {
          return new Response(
            JSON.stringify({
              credentials: [
                {
                  id: "22222222-2222-4222-8222-222222222222",
                  venue: "htx",
                  exchangeAccountId: "account-1",
                  apiKeyMasked: "abc…xyz",
                  status: "active",
                  permissionMetadata: null,
                  createdAt: "2026-08-28T11:00:00.000Z",
                  updatedAt: "2026-08-28T11:00:00.000Z",
                  revokedAt: null,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/trader/account-observation/binding?")) {
          return new Response(null, { status: 204 });
        }
        return new Response(
          JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    render(<TraderWorkspace />);

    await waitFor(() => expect(screen.getByTestId("trader-unpublished-note")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_OBSERVATION_FIRST_TICK_COPY)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("trader-account-status")).toHaveTextContent("HTX подключен в WAIA");
    expect(screen.getByTestId("trader-credential-account-id")).toHaveTextContent("account-1");
    expect(screen.getByTestId("trader-credential-masked-key")).toHaveTextContent("abc…xyz");
    expect(screen.getByText("User account")).toBeInTheDocument();
    expect(screen.getByText(/cannot enable live trading/)).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT_OBSERVATION_FIRST_TICK_COPY)).toBeInTheDocument();
    expect(screen.queryByTestId("trader-sync-balances")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trader-unavailable-read-model")).not.toBeInTheDocument();
    expect(screen.getByTestId("trader-authority-boundary")).toHaveTextContent("Только наблюдение");
    expect(screen.queryByRole("button", { name: /enable live/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /kill switch/i })).not.toBeInTheDocument();
  });

  it("explains accepted Read+Trade observation access and immediately shows the synthetic account snapshot", async () => {
    const now = Date.now();
    const credential = {
      id: "22222222-2222-4222-8222-222222222222",
      venue: "htx",
      exchangeAccountId: "account-read-trade",
      apiKeyMasked: "synt…key",
      status: "active",
      permissionMetadata: {
        version: 2,
        purpose: "observation",
        marketType: "spot",
        exchangeAccountId: "account-read-trade",
        scopes: ["read", "trade"],
        warnings: [],
        withdrawForbidden: true,
        transferForbidden: true,
      },
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      revokedAt: null,
    };
    const binding = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      credentialId: credential.id,
      exchangeAccountId: credential.exchangeAccountId,
      credentialRevision: "1",
      configurationRevision: "1",
    };
    const component = <T,>(values: T[]) => ({
      status: "COMPLETE",
      values,
      sourceAsOfMs: now,
      readStartedAtMs: now,
      readCompletedAtMs: now,
      error: null,
    });
    const observation = {
      schemaVersion: "account-observation/v1",
      observationId: "33333333-3333-4333-8333-333333333333",
      binding,
      collectionStartedAtMs: now,
      collectionCompletedAtMs: now,
      status: "COMPLETE",
      balances: component([{ asset: "USDT", free: "125.50", locked: "4.50", total: "130.00" }]),
      openOrders: component([]),
      trades: [{ symbol: "BTCUSDT", component: component([]) }],
      holdings: [{ asset: "USDT", free: "125.50", locked: "4.50", total: "130.00" }],
    };
    let connected = false;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/trader/exchange-credentials" && init?.method !== "POST") {
        return new Response(JSON.stringify({ credentials: connected ? [credential] : [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/trader/exchange-credentials/connect") {
        connected = true;
        return new Response(JSON.stringify(credential), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/trader/account-observation/binding?")) {
        return new Response(JSON.stringify(binding), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/trader/account-observation/stream?")) {
        return new Response(`event: observation\ndata: ${JSON.stringify(observation)}\n\n`, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TraderWorkspace />);

    expect(await screen.findByTestId("trader-permission-explainer")).toHaveTextContent(
      "ключ с Read и Trade тоже можно подключить",
    );
    expect(screen.getByTestId("trader-permission-explainer")).toHaveTextContent(
      "Не включайте Withdraw",
    );
    expect(screen.getByTestId("trader-permission-explainer")).toHaveTextContent(
      "не выполняет торговые операции",
    );
    fireEvent.change(screen.getByTestId("trader-api-key"), { target: { value: "synthetic-read-trade-key" } });
    fireEvent.change(screen.getByTestId("trader-api-secret"), {
      target: { value: "synthetic-secret" },
    });
    fireEvent.submit(screen.getByTestId("trader-connect-form"));

    expect(await screen.findByTestId("trader-credential-account-id")).toHaveTextContent("account-read-trade");
    expect(screen.queryByTestId("trader-api-key")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trader-api-secret")).not.toBeInTheDocument();
    expect(screen.getByTestId("trader-credential-scopes")).toHaveTextContent("read, trade");
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/trader/account-observation/stream?"))).toBe(true),
    );
    expect(await screen.findByTestId("cabinet-usdt-free")).toHaveTextContent("125.50");
    expect(screen.getByTestId("trader-authority-boundary")).toHaveTextContent("Только наблюдение");
    expect(screen.getByText(/Только просмотр\..*заявки отсюда не отправляются\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("synthetic-secret");
  });

  it("does not fetch or render real HTX workspace state while observing a historical campaign", async () => {
    mockSearchParams.set("campaign_run_id", "historical-run-1");
    mockSearchParams.set("account_id", "tenant-account-1");
    const fetchMock = vi.fn();
    const source = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onerror: null,
    };
    vi.stubGlobal("fetch", fetchMock);
    const EventSourceMock = vi.fn(() => source);
    vi.stubGlobal("EventSource", EventSourceMock);
    render(<TraderWorkspace />);
    await waitFor(() =>
      expect(EventSourceMock).toHaveBeenCalledWith(
        "/api/trader/historical-v2/stream?run_id=historical-run-1&account_id=tenant-account-1",
        { withCredentials: true },
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trader-connect-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trader-sync-balances")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trader-error-message")).not.toBeInTheDocument();
  });

  it("waits through an empty tenant projection and renders the first exact account snapshot", async () => {
    let snapshotListener: ((event: MessageEvent<string>) => void) | undefined;
    const source = {
      addEventListener: vi.fn((kind: string, listener: (event: MessageEvent<string>) => void) => {
        if (kind === "historical.snapshot") snapshotListener = listener;
      }),
      close: vi.fn(),
      onopen: null,
      onerror: null,
    };
    vi.stubGlobal(
      "EventSource",
      vi.fn(() => source),
    );
    render(
      <HistoricalV2ObservationDashboard
        endpoint="/tenant-stream"
        runId="run-1"
        accountId="account-1"
      />,
    );
    const base = {
      schemaVersion: "waia.trader.historical_observable_read_model.v2",
      mode: "HISTORICAL_SIMULATION",
      capitalEligible: false,
      organizationId: "org-1",
      runId: "run-1",
      eventId: "empty",
      observedAt: "2026-09-01T00:00:00.000Z",
      lifecycle: {
        phase: "QUEUED",
        qualifiedTotalCycles: 10,
        committedCycles: 0,
        remainingCycles: 10,
        progressBps: 0,
        nextCycleSequence: 0,
        latestCommittedCycleId: null,
        observedAt: "2026-09-01T00:00:00.000Z",
        errorCode: null,
        contentDigestHex: "f".repeat(64),
      },
      aggregate: {
        accountCount: 0,
        cash: null,
        equity: null,
        netPnl: null,
        cycles: 0,
        decisions: 0,
        riskVetoes: 0,
        orders: 0,
        fills: 0,
        processedRecords: 0,
        latestCycleSequence: null,
        qualifiedTotalCycles: 10,
        committedCycles: 0,
        progressBps: 0,
        runPhase: "QUEUED",
      },
      accounts: [],
    };
    await waitFor(() => expect(snapshotListener).toBeTypeOf("function"));
    act(() =>
      snapshotListener?.(new MessageEvent("historical.snapshot", { data: JSON.stringify(base) })),
    );
    expect(screen.getByTestId("historical-v2-streaming-dashboard")).toBeInTheDocument();
    expect(screen.getByText("Qualified progress · 0 / 10 cycles")).toBeInTheDocument();
    const account = {
      accountId: "account-1",
      cycleSequence: 0,
      cycleId: "c0",
      symbol: "BTCUSDT",
      partition: "DEVELOPMENT",
      replayBarClosedAtUtc: "2026-01-01T00:00:00.000Z",
      cash: "100.00000000",
      equity: "100.00000000",
      grossRealizedPnl: "0.00000000",
      netRealizedPnl: "0.00000000",
      netUnrealizedPnl: "0.00000000",
      netPnl: "0.00000000",
      buyAndHoldGrossEquity: "100.00000000",
      strategyMinusBuyAndHoldGross: "0.00000000",
      buyAndHoldConvention: "GROSS_MARK_TO_MARKET_NO_FEES",
      openPositionsCount: 0,
      decisionsCount: 1,
      riskVetoCount: 0,
      ordersCount: 0,
      fillsCount: 0,
      lastForecast: { reasonCodes: ["FORECAST_READY"] },
      lastDecision: { reasonCodes: ["CASH"] },
      lastPortfolio: { reasonCodes: ["PORTFOLIO_CASH"] },
      lastRisk: { reasonCodes: ["RISK_NOT_EVALUATED"] },
      lastExecution: { reasonCodes: ["NO_DISPATCH"] },
      lastAccounting: { positions: {} },
      lastGuardian: { reasonCodes: ["GUARDIAN_NONE"] },
      lastLearning: { reasonCodes: ["NO_UPDATE"] },
      observedExecutionEffects: [],
      modeledRealityArtifacts: [{ sourcePayload: { reasonCodes: ["REALITY_RECONCILED"] } }],
      knowledgeArtifacts: [{ sourcePayload: { reasonCodes: ["KNOWLEDGE_BOUND"] } }],
      stages: [],
      snapshots: [],
      checkpoint: null,
      ledgerHeadContentDigestHex: "a".repeat(64),
    };
    act(() =>
      snapshotListener?.(
        new MessageEvent("historical.snapshot", {
          data: JSON.stringify({
            ...base,
            eventId: "first",
            aggregate: {
              ...base.aggregate,
              accountCount: 1,
              processedRecords: 1,
              latestCycleSequence: 0,
            },
            accounts: [account],
          }),
        }),
      ),
    );
    expect(screen.getByText("account-1")).toBeInTheDocument();
    expect(screen.getAllByText(/FORECAST_READY/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PORTFOLIO_CASH/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/REALITY_RECONCILED/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/KNOWLEDGE_BOUND/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/scope mismatch/i)).not.toBeInTheDocument();
    act(() =>
      snapshotListener?.(
        new MessageEvent("historical.snapshot", {
          data: JSON.stringify({
            ...base,
            lifecycle: null,
            eventId: "legacy-no-lifecycle",
            aggregate: {
              ...base.aggregate,
              accountCount: 1,
              processedRecords: 1,
              latestCycleSequence: 0,
            },
            accounts: [account],
          }),
        }),
      ),
    );
    expect(screen.getByText(/start\/completion status cannot be confirmed/)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByText(/Pending-order evidence unavailable/)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByText("No run has started.", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText("Complete reason journal · 1 committed cycles")).toBeInTheDocument();
  });

  it("surfaces the durable lifecycle stop/refusal code", async () => {
    let snapshotListener: ((event: MessageEvent<string>) => void) | undefined;
    const source = {
      addEventListener: vi.fn((kind: string, listener: (event: MessageEvent<string>) => void) => {
        if (kind === "historical.snapshot") snapshotListener = listener;
      }),
      close: vi.fn(),
      onopen: null,
      onerror: null,
    };
    vi.stubGlobal(
      "EventSource",
      vi.fn(() => source),
    );
    render(<HistoricalV2ObservationDashboard endpoint="/tenant-stream" runId="run-1" />);
    await waitFor(() => expect(snapshotListener).toBeTypeOf("function"));
    const projection = {
      schemaVersion: "waia.trader.historical_observable_read_model.v2",
      mode: "HISTORICAL_SIMULATION",
      capitalEligible: false,
      organizationId: "org-1",
      runId: "run-1",
      eventId: "failed",
      observedAt: "2026-09-01T00:00:00.000Z",
      lifecycle: {
        phase: "FAILED",
        qualifiedTotalCycles: 35,
        committedCycles: 4,
        remainingCycles: 31,
        progressBps: 1142,
        nextCycleSequence: 4,
        latestCommittedCycleId: "c3",
        observedAt: "2026-09-01T00:04:00.000Z",
        errorCode: "FORECAST_PERSISTED_REFUSED",
        contentDigestHex: "f".repeat(64),
      },
      aggregate: {
        accountCount: 0,
        cash: null,
        equity: null,
        netPnl: null,
        buyAndHoldGrossEquity: null,
        strategyMinusBuyAndHoldGross: null,
        cycles: 0,
        decisions: 0,
        riskVetoes: 0,
        orders: 0,
        fills: 0,
        processedRecords: 0,
        latestCycleSequence: null,
        qualifiedTotalCycles: 35,
        committedCycles: 4,
        progressBps: 1142,
        runPhase: "FAILED",
      },
      accounts: [],
    };
    act(() =>
      snapshotListener?.(
        new MessageEvent("historical.snapshot", { data: JSON.stringify(projection) }),
      ),
    );
    expect(screen.getByTestId("historical-lifecycle-error")).toHaveTextContent(
      "FORECAST_PERSISTED_REFUSED",
    );
  });
});
