import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectedAccountObservationPanel } from "@/components/trader/account-observation/connected-account-observation-panel";
import type {
  AccountObservation,
  ObservationBinding,
} from "@/lib/trader/account-observation/types";

const binding: ObservationBinding = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  credentialId: "22222222-2222-4222-8222-222222222222",
  exchangeAccountId: "account-a",
  credentialRevision: "1",
  configurationRevision: "1",
};
const target = { credentialId: binding.credentialId, exchangeAccountId: binding.exchangeAccountId };
function observation(): AccountObservation {
  const now = Date.now();
  const empty = {
    status: "COMPLETE" as const,
    values: [],
    error: null,
    sourceAsOfMs: now,
    readStartedAtMs: now,
    readCompletedAtMs: now,
  };
  return {
    schemaVersion: "account-observation/v1",
    observationId: "33333333-3333-4333-8333-333333333333",
    binding,
    collectionStartedAtMs: now,
    collectionCompletedAtMs: now,
    status: "COMPLETE",
    balances: empty,
    openOrders: empty,
    holdings: [],
    trades: [{ symbol: "BTCUSDT", component: empty }],
  };
}
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
async function settle() {
  await act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DEE-961 connected panel (fake HTTP only)", () => {
  it("resolves authorized binding then automatically polls the exact account", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        json(String(input).includes("/binding?") ? binding : observation()),
      );
    render(<ConnectedAccountObservationPanel target={target} fetcher={fetcher} />);
    await settle();
    expect(screen.getByText("33333333-3333-4333-8333-333333333333")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("CURRENT");
    expect(fetcher.mock.calls[0][0]).toContain("/api/trader/account-observation/binding?");
    expect(fetcher.mock.calls[0][0]).not.toContain("organizationId");
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    expect(fetcher.mock.calls[1][0]).toContain("credentialRevision=1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("uses admin endpoint with exact organization scope", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        json(String(input).includes("/binding?") ? binding : observation()),
      );
    render(
      <ConnectedAccountObservationPanel
        mode="admin"
        target={{ ...target, organizationId: binding.organizationId }}
        fetcher={fetcher}
      />,
    );
    await settle();
    expect(fetcher.mock.calls[0][0]).toContain("/api/trader/admin/account-observation/binding?");
    expect(fetcher.mock.calls[0][0]).toContain(`organizationId=${binding.organizationId}`);
    expect(screen.getByText("33333333-3333-4333-8333-333333333333")).toBeInTheDocument();
  });
  it("does not fetch for no account or invalid metadata", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const { rerender } = render(
      <ConnectedAccountObservationPanel target={null} fetcher={fetcher} />,
    );
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("DISCONNECTED");
    rerender(
      <ConnectedAccountObservationPanel
        target={{ ...target, credentialId: "not-a-record-id" }}
        fetcher={fetcher}
      />,
    );
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("ERROR");
  });
  it.each([401, 403])(
    "HTTP %s during binding lookup clears and stops without a retry",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      render(<ConnectedAccountObservationPanel target={target} fetcher={fetcher} />);
      await settle();
      expect(screen.getByText("Access revoked; account data cleared.")).toBeInTheDocument();
      await act(async () => vi.advanceTimersByTimeAsync(60_000));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("marks unconfigured collection explicitly and rechecks automatically", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 204 }));
    render(<ConnectedAccountObservationPanel target={target} fetcher={fetcher} />);
    await settle();
    expect(screen.getByText(/Automatic collection is not configured/)).toBeInTheDocument();
    expect(screen.queryByText("Observed zero rows.")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url]) => String(url).includes("/binding?"))).toBe(true);
  });
  it("503 is not success; retries with bounded backoff and generic copy", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response("private-server-detail", { status: 503 }));
    render(<ConnectedAccountObservationPanel target={target} fetcher={fetcher} />);
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("ERROR");
    expect(screen.queryByText("private-server-detail")).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(9999));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["account", "organization", "raw"])(
    "rejects %s binding mismatch or unexpected fields",
    async (mode) => {
      const body =
        mode === "account"
          ? { ...binding, exchangeAccountId: "wrong" }
          : mode === "organization"
            ? { ...binding, organizationId: "44444444-4444-4444-8444-444444444444" }
            : { ...binding, apiSecret: "private" };
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(body));
      render(
        <ConnectedAccountObservationPanel
          mode="admin"
          target={{ ...target, organizationId: binding.organizationId }}
          fetcher={fetcher}
        />,
      );
      await settle();
      expect(screen.getByRole("status")).toHaveTextContent("ERROR");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("private")).not.toBeInTheDocument();
    },
  );
  it("clears previous evidence when target changes and ignores a late binding response", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );
    const { rerender } = render(
      <ConnectedAccountObservationPanel target={target} fetcher={fetcher} />,
    );
    await settle();
    const resolveOld = resolve;
    rerender(
      <ConnectedAccountObservationPanel
        target={{ ...target, exchangeAccountId: "account-b" }}
        fetcher={fetcher}
      />,
    );
    await settle();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolveOld(json(binding));
    await settle();
    expect(screen.queryByText("33333333-3333-4333-8333-333333333333")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("binding timeout is visible and does not overlap ignored-abort requests", async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const { unmount } = render(
      <ConnectedAccountObservationPanel target={target} fetcher={fetcher} />,
    );
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.getByRole("status")).toHaveTextContent("ERROR");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("projection access loss clears a previously rendered account", async () => {
    let count = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).includes("/binding?")) return json(binding);
      return ++count === 1 ? json(observation()) : new Response(null, { status: 403 });
    });
    render(<ConnectedAccountObservationPanel target={target} fetcher={fetcher} />);
    await settle();
    expect(screen.getByText("33333333-3333-4333-8333-333333333333")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    await settle();
    expect(screen.queryByText("33333333-3333-4333-8333-333333333333")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("REVOKED");
    expect(vi.getTimerCount()).toBe(0);
  });
});
