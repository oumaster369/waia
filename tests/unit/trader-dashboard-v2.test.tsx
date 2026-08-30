import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { snapshotAgeText, TraderWorkspace } from "@/components/trader/trader-workspace";

const { mockSearchParams } = vi.hoisted(() => ({ mockSearchParams: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mockSearchParams.delete("campaign_run_id");
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

  it("renders verified tenant data and keeps protected posture read-only and unavailable", async () => {
    const responses: Record<string, unknown> = {
      "/api/trader/exchange-credentials": {
        credentials: [
          {
            id: "credential-1",
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
      },
      "/api/trader/balance-snapshots?credentialId=credential-1&limit=5": {
        snapshots: [
          {
            id: "balance-1",
            credentialId: "credential-1",
            venue: "htx",
            exchangeAccountId: "account-1",
            balances: [],
            assetCount: 0,
            syncedAt: "2999-08-28T11:00:00.000Z",
            createdAt: "2026-08-28T11:00:00.000Z",
          },
        ],
      },
      "/api/trader/position-snapshots?credentialId=credential-1&limit=5": {
        snapshots: [
          {
            id: "position-1",
            credentialId: "credential-1",
            venue: "htx",
            exchangeAccountId: "account-1",
            positions: [],
            positionCount: 0,
            syncedAt: "2020-08-28T11:00:00.000Z",
            createdAt: "2020-08-28T11:00:00.000Z",
          },
        ],
      },
      "/api/trader/trade-history-snapshots?credentialId=credential-1&symbol=ETH%2FUSDT&limit=5": {
        snapshots: [
          {
            id: "trade-1",
            credentialId: "credential-1",
            venue: "htx",
            exchangeAccountId: "account-1",
            symbol: "ETH/USDT",
            trades: [],
            tradeCount: 0,
            syncedAt: "not-a-timestamp",
            createdAt: "2026-08-28T11:00:00.000Z",
          },
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const body = responses[url];
        return new Response(
          JSON.stringify(body ?? { error: { code: "NOT_FOUND", message: "not found" } }),
          {
            status: body ? 200 : 404,
            headers: { "Content-Type": "application/json" },
          },
        );
      }),
    );

    render(<TraderWorkspace />);

    await waitFor(() => expect(screen.getByTestId("trader-system-posture")).toBeInTheDocument());
    expect(screen.getByTestId("trader-account-status")).toHaveTextContent("HTX connected");
    expect(screen.getAllByTestId("trader-unavailable-read-model")).toHaveLength(6);
    expect(screen.getByText("This snapshot contains no asset balances.")).toBeInTheDocument();
    expect(screen.getByText("This snapshot contains no open spot positions.")).toBeInTheDocument();
    expect(screen.getByText("This snapshot contains no trades for ETH/USDT.")).toBeInTheDocument();
    expect(screen.getAllByText("Timestamp unknown")).toHaveLength(2);
    expect(screen.getByText(/Observed \d+ minutes ago/)).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
    expect(screen.getByTestId("trader-authority-boundary")).toHaveTextContent(
      "Live enablement, kill switches, strategy promotion",
    );
    expect(screen.queryByRole("button", { name: /enable live/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /kill switch/i })).not.toBeInTheDocument();
  });

  it("does not fetch or render real HTX workspace state while observing a historical campaign", async () => {
    mockSearchParams.set("campaign_run_id", "historical-run-1");
    const fetchMock = vi.fn();
    const source = { addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn(), onopen: null, onerror: null };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", vi.fn(() => source));
    render(<TraderWorkspace />);
    expect(await screen.findByTestId("fhv-user-streaming-dashboard")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("trader-connect-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trader-sync-balances")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trader-error-message")).not.toBeInTheDocument();
  });
});
