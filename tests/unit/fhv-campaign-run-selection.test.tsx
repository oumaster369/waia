import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import FhvOperationsAdminPage from "@/app/(trader)/admin/fhv-operations/page";

const ORG_ID = "00000000-0000-4000-8000-0000000416a1";
const RUN_ID = "dee-416-ui-run";
const { mockSearchParams } = vi.hoisted(() => ({ mockSearchParams: new URLSearchParams("campaign_run_id=dee-416-ui-run") }));

vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));
vi.mock("@/components/trader/admin/admin-org-selector", () => ({
  AdminOrgSelector: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <select data-testid="admin-org-selector" value={value} onChange={(event) => onChange(event.target.value)}><option value={ORG_ID}>{ORG_ID}</option><option value="00000000-0000-4000-8000-0000000416b2">other-org</option></select>,
  AdminLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
  AdminErrorState: ({ message }: { message: string }) => <div role="alert">{message}</div>,
  useAdminOrganizations: () => ({ organizations: [{ id: ORG_ID, name: "Test Org" }, { id: "00000000-0000-4000-8000-0000000416b2", name: "Other Org" }], loading: false, error: null }),
}));

function statusResponse() {
  return JSON.stringify({schemaVersion:"waia.trader.historical_observable_read_model.v2",mode:"HISTORICAL_SIMULATION",capitalEligible:false,
    organizationId:ORG_ID,runId:RUN_ID,eventId:"0:head",observedAt:"2026-09-01T00:00:00.000Z",
    aggregate:{accountCount:1,cash:"100.00000000",equity:"101.00000000",netPnl:"1.00000000",cycles:1,decisions:1,riskVetoes:0,orders:0,fills:0,processedRecords:1,latestCycleSequence:0},
    accounts:[{accountId:"historical:a",cycleSequence:0,cycleId:"c0",symbol:"BTCUSDT",partition:"DEVELOPMENT",replayBarClosedAtUtc:"2026-01-01T00:00:00.000Z",cash:"100.00000000",equity:"101.00000000",netPnl:"1.00000000",grossRealizedPnl:"1.25000000",netRealizedPnl:"1.00000000",netUnrealizedPnl:"0.00000000",openPositionsCount:1,decisionsCount:1,riskVetoCount:0,ordersCount:0,fillsCount:0,lastDecision:{reasonCodes:["CASH"]},lastRisk:{status:"PERMITTED"},lastExecution:{status:"NO_TRADE"},lastAccounting:{positions:{BTCUSDT:{quantity:"0.00000000"},ETHUSDT:{quantity:"2.00000000"}}},lastGuardian:{},lastLearning:{},observedExecutionEffects:[],stages:["KNOWLEDGE"],snapshots:["ACCOUNTING_FRONTIER"],checkpoint:{committedCycleSequence:0,nextRecordIndex:1,nextCycleSequence:1,contentDigestHex:"a".repeat(64)},ledgerHeadContentDigestHex:"b".repeat(64)}]});
}

describe("DEE-785 streaming FHV Admin Console", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mockSearchParams.set("campaign_run_id", RUN_ID); });

  it("connects automatically with exact organization and campaign binding", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe(`/api/trader/admin/historical-v2/stream?organization_id=${encodeURIComponent(ORG_ID)}&run_id=${encodeURIComponent(RUN_ID)}&transport=poll`);
      return new Response(statusResponse(), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    await waitFor(() => expect(screen.getByTestId("historical-v2-streaming-dashboard")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("Sync balances")).not.toBeInTheDocument();
    expect(screen.getAllByText(RUN_ID)).toHaveLength(1);
    expect(screen.getByText(/committed records/i)).toBeInTheDocument();
    expect(screen.getByText("Gross realized P&L")).toBeInTheDocument();
    expect(screen.getByText("Net realized P&L")).toBeInTheDocument();
    expect(screen.getByText("Net unrealized P&L")).toBeInTheDocument();
    expect(screen.getByText("ETHUSDT: qty 2.00000000")).toBeInTheDocument();
    expect(screen.queryByText("BTCUSDT: qty 0.00000000")).not.toBeInTheDocument();
  });

  it("does not connect until a valid campaign run ID is supplied", async () => {
    mockSearchParams.delete("campaign_run_id");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Campaign run ID is required.");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("fhv-campaign-run-id"), { target: { value: "invalid id" } });
    expect(screen.getByRole("alert")).toHaveTextContent("format is invalid");
  });

  it("keeps the last good snapshot visible while reconnecting", async () => {
    let requests = 0;
    const fetchMock = vi.fn(async () => {
      requests += 1;
      if (requests === 1) return new Response(statusResponse(), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: { message: "temporary outage" } }), { status: 503, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    await waitFor(() => expect(screen.getByTestId("historical-v2-streaming-dashboard")).toBeInTheDocument());
    expect(screen.getByText("Historical V2 · live observation")).toBeInTheDocument();
  });

  it("uses the authenticated admin SSE endpoint and subscribes to the full event contract", async () => {
    const listeners: string[] = [];
    const source = { onopen: null as (() => void) | null, onerror: null as (() => void) | null, addEventListener: vi.fn((kind: string) => listeners.push(kind)), close: vi.fn() };
    const EventSourceMock = vi.fn(() => source);
    vi.stubGlobal("EventSource", EventSourceMock);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(statusResponse(), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<FhvOperationsAdminPage />);
    await waitFor(() => expect(EventSourceMock).toHaveBeenCalledTimes(1));
    expect(EventSourceMock).toHaveBeenCalledWith(`/api/trader/admin/historical-v2/stream?organization_id=${encodeURIComponent(ORG_ID)}&run_id=${encodeURIComponent(RUN_ID)}`, { withCredentials: true });
    expect(listeners).toEqual(["historical.snapshot", "heartbeat"]);
  });

  it("starts only one polling fallback after duplicate SSE errors", async () => {
    const source = { onopen: null as (() => void) | null, onerror: null as (() => void) | null, addEventListener: vi.fn(), close: vi.fn() };
    vi.stubGlobal("EventSource", vi.fn(() => source));
    const fetchMock = vi.fn(async () => new Response(statusResponse(), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    await waitFor(() => expect(source.onerror).toBeTypeOf("function"));
    source.onerror?.();
    source.onerror?.();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("refuses a wrong-organization projection and permanently stops polling", async () => {
    vi.useFakeTimers();
    const wrongOrganization = JSON.parse(statusResponse()) as Record<string, unknown>;
    wrongOrganization.organizationId = "00000000-0000-4000-8000-0000000416ff";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(wrongOrganization), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FhvOperationsAdminPage />);
    await vi.waitFor(() => expect(screen.getByText(/identity mismatch/i)).toBeInTheDocument());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("historical-v2-streaming-dashboard")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
