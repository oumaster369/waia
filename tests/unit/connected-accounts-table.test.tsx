import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_CONNECTED_ACCOUNTS_POLL_MS,
  ConnectedAccountsTable,
} from "@/components/trader/admin/connected-accounts-table";
import type { AccountObservation } from "@/lib/trader/account-observation/types";
import { ACCOUNT_OBSERVATION_STALE_AFTER_MS } from "@/lib/trader/account-observation/cabinet-view";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";

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

function observationWithFuturesBalance(
  balanceStatus: "COMPLETE" | "ERROR",
  readCompletedAtMs: number,
  accountValues = { equityUsd: "0", availableMarginUsd: "0.00", profitUnrealUsd: "-0.000" },
): AccountObservation {
  const readTimes = {
    readStartedAtMs: readCompletedAtMs,
    readCompletedAtMs,
    responseGeneratedAtMs: readCompletedAtMs,
  };
  const collectionStartedAtMs = Math.min(now, readCompletedAtMs);
  const algoPageScope = {
    pageSize: 20,
    maxPagesPerType: 2,
    queries: ["tp", "sl", "tpsl", "trigger", "trailing_stop"].map((type) => ({
      type,
      pagesRead: 1,
      nextFrom: null,
    })),
    completeness: "UNKNOWN" as const,
  };
  return parseAccountObservation({
    ...observation(),
    schemaVersion: "account-observation/v3",
    collectionStartedAtMs,
    status: "PARTIAL",
    htxV5: {
      schemaVersion: "htx-v5-observation/v1",
      htxUid: "123456",
      assetMode: { ...readTimes, status: "COMPLETE", value: "1", error: null },
      balance: {
        ...readTimes,
        status: balanceStatus,
        value:
          balanceStatus === "COMPLETE"
            ? {
                state: "normal",
                account: {
                  ...accountValues,
                  initialMarginUsd: "0",
                  maintenanceMarginUsd: "0",
                  maintenanceMarginRate: "0",
                  voucherValue: "0",
                  createdTimeMs: now,
                  updatedTimeMs: now,
                },
                details: [],
              }
            : null,
        error: balanceStatus === "ERROR" ? "READ_FAILED" : null,
      },
      positions: {
        ...readTimes,
        status: "COMPLETE",
        values: [],
        error: null,
        pageScope: null,
      },
      openOrders: {
        ...readTimes,
        status: "PARTIAL",
        values: [],
        error: null,
        pageScope: {
          pageSize: 20,
          maxPages: 2,
          pagesRead: 1,
          nextFrom: null,
          completeness: "UNKNOWN",
        },
      },
      algoOrders: {
        ...readTimes,
        status: "PARTIAL",
        values: [],
        error: null,
        pageScope: algoPageScope,
      },
      fills: {
        status: "NOT_CONFIGURED",
        values: null,
        readStartedAtMs: null,
        readCompletedAtMs: null,
        responseGeneratedAtMs: null,
        error: null,
        coverage: "NOT_CONFIGURED",
        contracts: [],
        windowStartMs: null,
        windowEndMs: null,
        pageScope: null,
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("admin connected accounts table", () => {
  const exactBinding = {
    organizationId: account.organizationId,
    credentialId: account.credentialId,
    exchangeAccountId: account.exchangeAccountId,
    credentialRevision: "1",
    configurationRevision: "1",
  };

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
    expect(screen.getByRole("columnheader", { name: "Спот USDT · доступно" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Фьючерсы · USD" })).toBeInTheDocument();
    expect(screen.getByText("Данные фьючерсов не получены")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Credential record ID/)).not.toBeInTheDocument();
  });

  it("shows the separate V5 USD balance with its own stale time and preserves zeros", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    const snapshot = observationWithFuturesBalance(
      "COMPLETE",
      now - ACCOUNT_OBSERVATION_STALE_AFTER_MS - 1,
    );
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
        if (url.includes("/binding?")) return Response.json(binding);
        if (url.includes("/api/trader/admin/account-observation?")) {
          return Response.json(snapshot);
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText(/Капитал HTX:/)).toBeInTheDocument());
    const futuresCell = screen.getByText(/Капитал HTX:/).closest("td");
    expect(futuresCell).toHaveTextContent("Капитал HTX: 0 USD");
    expect(futuresCell).toHaveTextContent("Доступная маржа: 0.00 USD");
    expect(futuresCell).toHaveTextContent("Нереализованный результат HTX: -0.000 USD");
    expect(futuresCell).toHaveTextContent("Устаревший срез");
    expect(futuresCell).not.toHaveTextContent("12.5");
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("shows an unavailable futures balance as unavailable and links to details", async () => {
    const snapshot = observationWithFuturesBalance("ERROR", now);
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
        if (url.includes("/binding?")) return Response.json(binding);
        if (url.includes("/api/trader/admin/account-observation?")) {
          return Response.json(snapshot);
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(<ConnectedAccountsTable />);
    await waitFor(() =>
      expect(screen.getByText("Баланс фьючерсов недоступен")).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Открыть детали" })).toHaveAttribute(
      "href",
      `/admin/account-observation?organization_id=${account.organizationId}&credential_id=${account.credentialId}&exchange_account_id=${account.exchangeAccountId}`,
    );
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

  it("clears prior account balances when the row binding changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const switchedAccount = {
      ...account,
      exchangeAccountId: "73750149",
      accountName: "Switched cabinet",
    };
    const binding = {
      organizationId: account.organizationId,
      credentialId: account.credentialId,
      exchangeAccountId: account.exchangeAccountId,
      credentialRevision: "1",
      configurationRevision: "1",
    };
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          listCalls += 1;
          return Response.json({ accounts: [listCalls === 1 ? account : switchedAccount] });
        }
        if (url.includes("/binding?")) {
          return url.includes("exchangeAccountId=73750149")
            ? new Response(null, { status: 204 })
            : Response.json(binding);
        }
        if (url.includes("/api/trader/admin/account-observation?")) {
          return Response.json(observation());
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText("12.5")).toBeInTheDocument());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() => expect(screen.getByText("Switched cabinet")).toBeInTheDocument());
    expect(screen.queryByText("12.5")).not.toBeInTheDocument();
    expect(screen.getByText("Ожидается первый снимок")).toBeInTheDocument();
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

  it("ages the futures balance after a refresh failure while the saved snapshot remains visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(now);
    const snapshot = observationWithFuturesBalance("COMPLETE", now, {
      equityUsd: "100",
      availableMarginUsd: "75",
      profitUnrealUsd: "2.5",
    });
    const binding = {
      organizationId: account.organizationId,
      credentialId: account.credentialId,
      exchangeAccountId: account.exchangeAccountId,
      credentialRevision: "1",
      configurationRevision: "1",
    };
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          listCalls += 1;
          return listCalls === 1
            ? Response.json({ accounts: [account] })
            : Response.json({ error: { message: "Unavailable." } }, { status: 503 });
        }
        if (url.includes("/binding?")) return Response.json(binding);
        if (url.includes("/api/trader/admin/account-observation?")) {
          return Response.json(snapshot);
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText(/Капитал HTX:/)).toBeInTheDocument());
    expect(screen.getByText(/Срез ·/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() =>
      expect(
        screen.getByText("The latest refresh failed. The table still shows the previous read."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Срез ·/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        ACCOUNT_OBSERVATION_STALE_AFTER_MS - ADMIN_CONNECTED_ACCOUNTS_POLL_MS + 1_000,
      );
    });
    await waitFor(() => expect(screen.getByText(/Устаревший срез ·/)).toBeInTheDocument());
    expect(screen.getByText(/Капитал HTX:/)).toBeInTheDocument();
  });

  it("keeps the previous list and says when a later refresh fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          listCalls += 1;
          if (listCalls > 1) {
            return Response.json({ error: { message: "Unavailable." } }, { status: 503 });
          }
          return Response.json({ accounts: [account] });
        }
        return new Response(null, { status: 204 });
      }),
    );
    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText("Partner cabinet")).toBeInTheDocument());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() =>
      expect(
        screen.getByText("The latest refresh failed. The table still shows the previous read."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Partner cabinet")).toBeInTheDocument();
    expect(screen.getByText("Connecting")).toBeInTheDocument();
  });

  it("clears the refresh notice after the next successful read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let listCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          listCalls += 1;
          if (listCalls === 2) {
            return Response.json({ error: { message: "Unavailable." } }, { status: 503 });
          }
          return Response.json({ accounts: [account] });
        }
        return new Response(null, { status: 204 });
      }),
    );
    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(screen.getByText("Partner cabinet")).toBeInTheDocument());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() =>
      expect(
        screen.getByText("The latest refresh failed. The table still shows the previous read."),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() =>
      expect(
        screen.queryByText("The latest refresh failed. The table still shows the previous read."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Partner cabinet")).toBeInTheDocument();
  });

  it.each([401, 403])(
    "clears previously displayed identity and balances on directory authorization loss (%s) and recovers after reauthorization",
    async (status) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(now);
      const snapshot = observationWithFuturesBalance("COMPLETE", now, {
        equityUsd: "100.25",
        availableMarginUsd: "75.5",
        profitUnrealUsd: "2.5",
      });
      let listCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (url === "/api/trader/admin/connected-accounts") {
            listCalls += 1;
            if (listCalls === 2) {
              return new Response("authorization expired", {
                status,
                headers: { "content-type": "text/plain" },
              });
            }
            return Response.json({ accounts: [account] });
          }
          if (url.includes("/binding?")) return Response.json(exactBinding);
          if (url.includes("/api/trader/admin/account-observation?")) return Response.json(snapshot);
          return new Response(null, { status: 404 });
        }),
      );

      render(<ConnectedAccountsTable />);
      await waitFor(() => expect(screen.getByText("100.25 USD")).toBeInTheDocument());
      expect(screen.getByText("Partner cabinet")).toBeInTheDocument();
      expect(screen.getByText("12.5")).toBeInTheDocument();
      expect(screen.getByText(account.exchangeAccountId)).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
      });
      await waitFor(() =>
        expect(screen.getByText("Доступ отозван. Данные счетов очищены.")).toBeInTheDocument(),
      );
      await waitFor(() => expect(screen.queryByText("Partner cabinet")).not.toBeInTheDocument());
      expect(screen.queryByText("100.25 USD")).not.toBeInTheDocument();
      expect(screen.queryByText("12.5")).not.toBeInTheDocument();
      expect(screen.queryByText(account.exchangeAccountId)).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
      });
      await waitFor(() => expect(screen.getByText("Partner cabinet")).toBeInTheDocument());
      expect(screen.getByText("100.25 USD")).toBeInTheDocument();
      expect(screen.getByText("12.5")).toBeInTheDocument();
    },
  );

  it.each(["network", "server"] as const)(
    "retains the previous authorized row and shows a refresh notice after a %s failure",
    async (failure) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(now);
      const snapshot = observationWithFuturesBalance("COMPLETE", now, {
        equityUsd: "100.25",
        availableMarginUsd: "75.5",
        profitUnrealUsd: "2.5",
      });
      let listCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (url === "/api/trader/admin/connected-accounts") {
            listCalls += 1;
            if (listCalls === 2) {
              if (failure === "network") throw new TypeError("synthetic network failure");
              return Response.json({ error: { message: "Unavailable." } }, { status: 503 });
            }
            return Response.json({ accounts: [account] });
          }
          if (url.includes("/binding?")) return Response.json(exactBinding);
          if (url.includes("/api/trader/admin/account-observation?")) return Response.json(snapshot);
          return new Response(null, { status: 404 });
        }),
      );

      render(<ConnectedAccountsTable />);
      await waitFor(() => expect(screen.getByText("100.25 USD")).toBeInTheDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
      });
      await waitFor(() =>
        expect(
          screen.getByText("The latest refresh failed. The table still shows the previous read."),
        ).toBeInTheDocument(),
      );
      expect(screen.getByText("Partner cabinet")).toBeInTheDocument();
      expect(screen.getByText("100.25 USD")).toBeInTheDocument();
      expect(screen.getByText("12.5")).toBeInTheDocument();
      expect(screen.getByText(account.exchangeAccountId)).toBeInTheDocument();
    },
  );

  it.each([
    ["organization", { organizationId: "99999999-9999-4999-8999-999999999999" }],
    ["credential", { credentialId: "88888888-8888-4888-8888-888888888888" }],
    ["exchange account", { exchangeAccountId: "other-account" }],
  ] as const)(
    "refuses a binding response for a different requested %s before reading its snapshot",
    async (_label, mismatch) => {
      const snapshotFetch = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (url === "/api/trader/admin/connected-accounts") {
            return Response.json({ accounts: [account] });
          }
          if (url.includes("/binding?")) return Response.json({ ...exactBinding, ...mismatch });
          if (url.includes("/api/trader/admin/account-observation?")) {
            snapshotFetch();
            return Response.json(observation());
          }
          return new Response(null, { status: 404 });
        }),
      );

      render(<ConnectedAccountsTable />);
      await waitFor(() => expect(screen.getByText("Данные фьючерсов недоступны")).toBeInTheDocument());
      expect(snapshotFetch).not.toHaveBeenCalled();
      expect(screen.queryByText("12.5")).not.toBeInTheDocument();
      expect(screen.queryByText("13.5")).not.toBeInTheDocument();
    },
  );

  it.each([
    ["organization", { organizationId: "99999999-9999-4999-8999-999999999999" }],
    ["credential", { credentialId: "88888888-8888-4888-8888-888888888888" }],
    ["exchange account", { exchangeAccountId: "other-account" }],
    ["credential revision", { credentialRevision: "2" }],
    ["configuration revision", { configurationRevision: "2" }],
  ] as const)(
    "refuses a snapshot with a changed %s after the binding read",
    async (_label, revisionPatch) => {
      const mismatchedSnapshot = parseAccountObservation({
        ...observationWithFuturesBalance("COMPLETE", now),
        binding: { ...exactBinding, ...revisionPatch },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (url === "/api/trader/admin/connected-accounts") {
            return Response.json({ accounts: [account] });
          }
          if (url.includes("/binding?")) return Response.json(exactBinding);
          if (url.includes("/api/trader/admin/account-observation?")) {
            return Response.json(mismatchedSnapshot);
          }
          return new Response(null, { status: 404 });
        }),
      );

      render(<ConnectedAccountsTable />);
      await waitFor(() =>
        expect(screen.getByText("Данные фьючерсов недоступны")).toBeInTheDocument(),
      );
      expect(screen.queryByText("12.5")).not.toBeInTheDocument();
      expect(screen.queryByText("13.5")).not.toBeInTheDocument();
    },
  );

  it("does not restore a late observation response after directory authorization is revoked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(now);
    let resolveSnapshot!: (response: Response) => void;
    const pendingSnapshot = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve;
    });
    let listCalls = 0;
    let snapshotCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/trader/admin/connected-accounts") {
          listCalls += 1;
          if (listCalls === 2) return new Response("expired", { status: 401 });
          return Response.json({ accounts: [account] });
        }
        if (url.includes("/binding?")) {
          return listCalls >= 3 ? new Response(null, { status: 204 }) : Response.json(exactBinding);
        }
        if (url.includes("/api/trader/admin/account-observation?")) {
          snapshotCalls += 1;
          return pendingSnapshot;
        }
        return new Response(null, { status: 404 });
      }),
    );

    render(<ConnectedAccountsTable />);
    await waitFor(() => expect(snapshotCalls).toBe(1));
    expect(screen.getByText("Partner cabinet")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() =>
      expect(screen.getByText("Доступ отозван. Данные счетов очищены.")).toBeInTheDocument(),
    );

    await act(async () => {
      resolveSnapshot(Response.json(observationWithFuturesBalance("COMPLETE", now)));
      await pendingSnapshot;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("Partner cabinet")).not.toBeInTheDocument();
    expect(screen.queryByText("12.5")).not.toBeInTheDocument();
    expect(screen.queryByText(account.exchangeAccountId)).not.toBeInTheDocument();
    expect(screen.getByText("Доступ отозван. Данные счетов очищены.")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ADMIN_CONNECTED_ACCOUNTS_POLL_MS);
    });
    await waitFor(() => expect(screen.getByText("Partner cabinet")).toBeInTheDocument());
    expect(screen.queryByText("12.5")).not.toBeInTheDocument();
    expect(screen.queryByText("13.5")).not.toBeInTheDocument();
    expect(screen.getByText("Ожидается первый снимок")).toBeInTheDocument();
  });
});
