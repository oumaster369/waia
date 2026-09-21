import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_CONNECTED_ACCOUNTS_POLL_MS,
  ConnectedAccountsTable,
} from "@/components/trader/admin/connected-accounts-table";
import type { AccountObservation } from "@/lib/trader/account-observation/types";

const account = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  accountName: "Partner cabinet",
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "73750148",
  venue: "htx" as const,
  status: "active" as const,
  updatedAt: "2026-09-20T00:00:00.000Z",
};

const now = 1_800_000_000_000;
function observation(): AccountObservation {
  const empty = {
    status: "COMPLETE" as const,
    values: [] as never[],
    error: null,
    sourceAsOfMs: now,
    readStartedAtMs: now,
    readCompletedAtMs: now,
  };
  return {
    schemaVersion: "account-observation/v1",
    observationId: "33333333-3333-4333-8333-333333333333",
    binding: {
      organizationId: account.organizationId,
      credentialId: account.credentialId,
      exchangeAccountId: account.exchangeAccountId,
      credentialRevision: "1",
      configurationRevision: "1",
    },
    collectionStartedAtMs: now,
    collectionCompletedAtMs: now,
    status: "COMPLETE",
    balances: {
      ...empty,
      values: [{ asset: "USDT", free: "12.5", locked: "1.0", total: "13.5" }],
    },
    holdings: [{ asset: "USDT", free: "12.5", locked: "1.0", total: "13.5" }],
    openOrders: empty,
    trades: [{ symbol: "BTCUSDT", component: empty }],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("admin connected accounts table", () => {
  it("lists HTX cabinets without UUID paste and hydrates USDT from observation", async () => {
    const binding = {
      organizationId: account.organizationId,
      credentialId: account.credentialId,
      exchangeAccountId: account.exchangeAccountId,
      credentialRevision: "1",
      configurationRevision: "1",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          return Response.json({ accounts: [account] });
        }
        if (url.includes("/binding?")) {
          return Response.json(binding);
        }
        if (url.includes("/api/trader/admin/account-observation?")) {
          return Response.json(observation());
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText("Partner cabinet")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Partner cabinet" })).toHaveAttribute(
      "href",
      `/admin/account-observation?organization_id=${account.organizationId}&credential_id=${account.credentialId}&exchange_account_id=${account.exchangeAccountId}`,
    );
    await waitFor(() => expect(screen.getByText("12.5")).toBeInTheDocument());
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("1.0")).toBeInTheDocument();
    expect(screen.getByText("73750148")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Credential record ID/)).not.toBeInTheDocument();
  });

  it("says Connecting when the first snapshot is not ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          return Response.json({ accounts: [account] });
        }
        return new Response(null, { status: 204 });
      }),
    );
    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText("Connecting")).toBeInTheDocument());
    expect(screen.queryByText("Waiting for observation")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
  });

  it("shows a cabinet that appears on the next poll", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          listCalls += 1;
          return Response.json({ accounts: listCalls === 1 ? [] : [account] });
        }
        return new Response(null, { status: 204 });
      }),
    );
    render(<ConnectedAccountsTable />);
    await waitFor(() =>
      expect(screen.getByText("No HTX-connected accounts yet.")).toBeInTheDocument(),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() => expect(screen.getByText("Partner cabinet")).toBeInTheDocument());
    expect(screen.getByText("Connecting")).toBeInTheDocument();
  });

  it("marks an old snapshot as Last tick", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60_000);
    const binding = {
      organizationId: account.organizationId,
      credentialId: account.credentialId,
      exchangeAccountId: account.exchangeAccountId,
      credentialRevision: "1",
      configurationRevision: "1",
    };
    const snapshot = observation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          return Response.json({ accounts: [account] });
        }
        if (url.includes("/binding?")) return Response.json(binding);
        if (url.includes("/api/trader/admin/account-observation?")) return Response.json(snapshot);
        return new Response(null, { status: 404 });
      }),
    );
    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText("Last tick")).toBeInTheDocument());
  });
});
