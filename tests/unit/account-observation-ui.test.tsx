import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountObservation,
  ObservationBinding,
  ObservationComponent,
} from "@/lib/trader/account-observation/types";
import { AccountObservationPanel } from "@/components/trader/account-observation/account-observation-panel";
import { createPollingObservationSubscriber } from "@/components/trader/account-observation/polling-subscriber";
import {
  useAccountObservation,
  type ObservationEvent,
  type ObservationSubscriber,
} from "@/components/trader/account-observation/use-account-observation";

const binding: ObservationBinding = {
  organizationId: "org-a",
  credentialId: "credential-a",
  exchangeAccountId: "account-a",
  credentialRevision: "1",
  configurationRevision: "1",
};
const now = 1_800_000_000_000;
function component<T>(values: T[]): ObservationComponent<T> {
  return {
    values,
    status: "COMPLETE",
    sourceAsOfMs: now - 50,
    readStartedAtMs: now - 100,
    readCompletedAtMs: now,
    error: null,
  };
}
function observation(patch: Partial<AccountObservation> = {}): AccountObservation {
  return {
    schemaVersion: "account-observation/v1",
    observationId: "obs-a",
    binding,
    collectionStartedAtMs: now - 100,
    collectionCompletedAtMs: now,
    status: "COMPLETE",
    balances: component([{ asset: "BTC", free: "1", locked: "0.1", total: "1.1" }]),
    holdings: [{ asset: "BTC", free: "1", locked: "0.1", total: "1.1" }],
    openOrders: component([]),
    trades: [{ symbol: "BTCUSDT", component: component([]) }],
    ...patch,
  };
}
function transport() {
  const listeners: {
    emit: (event: ObservationEvent) => void;
    signal: AbortSignal;
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  const subscribe: ObservationSubscriber = vi.fn((_binding, emit, signal) => {
    const dispose = vi.fn();
    listeners.push({ emit, signal, dispose });
    return dispose;
  });
  return { subscribe, listeners };
}
async function subscribed() {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DEE-961 injected observation subscription", () => {
  it("recovers after a polling error when the successful retry returns the same observation", async () => {
    const exactBinding = {
      ...binding,
      organizationId: "11111111-1111-4111-8111-111111111111",
      credentialId: "22222222-2222-4222-8222-222222222222",
    };
    const snapshot = observation({
      binding: exactBinding,
      observationId: "33333333-3333-4333-8333-333333333333",
    });
    const response = () => new Response(JSON.stringify(snapshot), {
      headers: { "content-type": "application/json" },
    });
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => response())
      .mockRejectedValueOnce(new Error("synthetic transient failure"))
      .mockImplementation(async () => response());
    const subscribe = createPollingObservationSubscriber({
      endpointPath: "/api/test-observation",
      fetcher,
      intervalMs: 1000,
      requestTimeoutMs: 1000,
      maxBackoffMs: 4000,
    });
    const { result } = renderHook(() => useAccountObservation({ binding: exactBinding, subscribe }));
    await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(result.current.status).toBe("CURRENT");
    const first = result.current.observation;
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.status).toBe("ERROR");
    expect(result.current.observation).toBe(first);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("CURRENT");
    expect(result.current.observation).toBe(first);
  });

  it("does not subscribe without an authorized binding", async () => {
    const t = transport();
    const { result } = renderHook(() =>
      useAccountObservation({ binding: null, subscribe: t.subscribe }),
    );
    await subscribed();
    expect(t.subscribe).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: "DISCONNECTED", observation: null, stale: false });
  });
  it("receives an observation automatically and ages it without a button", async () => {
    const t = transport();
    const { result } = renderHook(() =>
      useAccountObservation({ binding, subscribe: t.subscribe, staleAfterMs: 1000 }),
    );
    await subscribed();
    expect(result.current.status).toBe("LOADING");
    act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
    expect(result.current.status).toBe("CURRENT");
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.status).toBe("STALE");
    expect(result.current.observation?.observationId).toBe("obs-a");
  });
  it("bounds silent initial subscription instead of loading forever", async () => {
    const t = transport();
    const { result } = renderHook(() =>
      useAccountObservation({ binding, subscribe: t.subscribe, staleAfterMs: 1000 }),
    );
    await subscribed();
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.status).toBe("ERROR");
    expect(result.current.observation).toBeNull();
  });
  it.each(["disconnected", "error"] as const)(
    "retains labeled last evidence on %s and recovers",
    async (type) => {
      const t = transport();
      const { result } = renderHook(() =>
        useAccountObservation({ binding, subscribe: t.subscribe }),
      );
      await subscribed();
      act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
      act(() => t.listeners[0].emit({ type }));
      expect(result.current.status).toBe(type.toUpperCase());
      expect(result.current.observation?.observationId).toBe("obs-a");
      act(() => t.listeners[0].emit({ type: "connected" }));
      expect(result.current.status).toBe("CURRENT");
    },
  );
  it.each([
    "organizationId",
    "credentialId",
    "exchangeAccountId",
    "credentialRevision",
    "configurationRevision",
  ] as const)("clears on %s change and ignores an old subscriber", async (field) => {
    const t = transport();
    const { result, rerender } = renderHook(
      ({ scope }) => useAccountObservation({ binding: scope, subscribe: t.subscribe }),
      { initialProps: { scope: binding } },
    );
    await subscribed();
    act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
    rerender({ scope: { ...binding, [field]: "changed" } });
    expect(result.current.observation).toBeNull();
    await subscribed();
    expect(t.listeners[0].signal.aborted).toBe(true);
    expect(t.listeners[0].dispose).toHaveBeenCalledTimes(1);
    act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
    expect(result.current.observation).toBeNull();
  });
  it("clears on logout/null binding and cancels all resources on unmount", async () => {
    const t = transport();
    const { result, rerender, unmount } = renderHook(
      ({ scope }: { scope: ObservationBinding | null }) =>
        useAccountObservation({ binding: scope, subscribe: t.subscribe }),
      { initialProps: { scope: binding as ObservationBinding | null } },
    );
    await subscribed();
    act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
    rerender({ scope: null });
    expect(result.current.observation).toBeNull();
    expect(t.listeners[0].dispose).toHaveBeenCalledTimes(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not resurrect cached data when returning to the same account after logout", async () => {
    const t = transport();
    const { result, rerender } = renderHook(
      ({ scope }: { scope: ObservationBinding | null }) =>
        useAccountObservation({ binding: scope, subscribe: t.subscribe }),
      { initialProps: { scope: binding as ObservationBinding | null } },
    );
    await subscribed();
    act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
    rerender({ scope: null });
    rerender({ scope: binding });
    expect(result.current.observation).toBeNull();
    expect(result.current.status).toBe("LOADING");
    await subscribed();
    expect(result.current.observation).toBeNull();
  });
  it("revocation is terminal even when the old transport emits new data", async () => {
    const t = transport();
    const { result } = renderHook(() => useAccountObservation({ binding, subscribe: t.subscribe }));
    await subscribed();
    act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
    act(() => t.listeners[0].emit({ type: "revoked" }));
    act(() =>
      t.listeners[0].emit({
        type: "observation",
        observation: observation({ collectionCompletedAtMs: now + 1 }),
      }),
    );
    expect(result.current.status).toBe("REVOKED");
    expect(result.current.observation).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(t.listeners[0].signal.aborted).toBe(true);
    expect(t.listeners[0].dispose).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-scope data without displaying it", async () => {
    const t = transport();
    const { result } = renderHook(() => useAccountObservation({ binding, subscribe: t.subscribe }));
    await subscribed();
    act(() =>
      t.listeners[0].emit({
        type: "observation",
        observation: observation({ binding: { ...binding, organizationId: "other" } }),
      }),
    );
    expect(result.current.status).toBe("ERROR");
    expect(result.current.observation).toBeNull();
  });
  it("ignores duplicates/out-of-order snapshots without merging components", async () => {
    const t = transport();
    const { result } = renderHook(() => useAccountObservation({ binding, subscribe: t.subscribe }));
    await subscribed();
    act(() => t.listeners[0].emit({ type: "observation", observation: observation() }));
    act(() =>
      t.listeners[0].emit({
        type: "observation",
        observation: observation({ observationId: "older", collectionCompletedAtMs: now - 1 }),
      }),
    );
    expect(result.current.observation?.observationId).toBe("obs-a");
    const partial = observation({
      observationId: "new",
      collectionCompletedAtMs: now + 1,
      status: "PARTIAL",
      balances: { ...component([]), values: null, status: "ERROR", error: "TIMEOUT" },
      holdings: null,
    });
    act(() => t.listeners[0].emit({ type: "observation", observation: partial }));
    expect(result.current.status).toBe("PARTIAL");
    expect(result.current.observation?.balances.values).toBeNull();
  });
  it("catches subscriber exceptions without exposing raw details", async () => {
    const subscribe = () => {
      throw new Error("sensitive-driver-detail");
    };
    const { result } = renderHook(() => useAccountObservation({ binding, subscribe }));
    await subscribed();
    expect(result.current).toEqual({ status: "ERROR", observation: null, stale: false });
  });
  it("handles synchronous revocation and disposes exactly once", async () => {
    const dispose = vi.fn();
    const subscribe: ObservationSubscriber = (_scope, emit) => {
      emit({ type: "revoked" });
      return dispose;
    };
    const { result, unmount } = renderHook(() => useAccountObservation({ binding, subscribe }));
    await subscribed();
    unmount();
    expect(result.current.status).toBe("REVOKED");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("DEE-961 shared Admin/tenant renderer", () => {
  it("never renders an observation supplied with a revoked view", () => {
    render(
      <AccountObservationPanel
        view={{ status: "REVOKED", observation: observation(), stale: false }}
      />,
    );
    expect(screen.queryByText("obs-a")).not.toBeInTheDocument();
    expect(screen.getByText("Access revoked; account data cleared.")).toBeInTheDocument();
  });
  it("shows same observation ID and evidence, no sync/trading controls or invented PnL", () => {
    const view = { status: "CURRENT" as const, observation: observation(), stale: false };
    render(<AccountObservationPanel view={view} />);
    expect(screen.getByText("obs-a")).toBeInTheDocument();
    expect(screen.getByText("BTC: free 1, locked 0.1, total 1.1")).toBeInTheDocument();
    expect(screen.getAllByText("Observed zero rows.")).toHaveLength(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    cleanup();
    render(<AccountObservationPanel view={view} />);
    expect(screen.getByText("obs-a")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("CURRENT");
    expect(screen.getByText("BTC: free 1, locked 0.1, total 1.1")).toBeInTheDocument();
  });
  it("distinguishes missing/error from an observed zero", () => {
    const partial = observation({
      status: "PARTIAL",
      balances: { ...component([]), status: "ERROR", values: null, error: "TIMEOUT" },
      holdings: null,
    });
    render(
      <AccountObservationPanel view={{ status: "PARTIAL", observation: partial, stale: false }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("PARTIAL");
    expect(screen.getByText("Read error: TIMEOUT")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable — not an observed zero.")).toHaveLength(2);
    expect(screen.getByText(/Last received observation/)).toBeInTheDocument();
  });
  it("renders financial decimal strings without float rounding", () => {
    const o = observation({
      balances: component([
        {
          asset: "USDT",
          free: "9007199254740993.00000001",
          locked: "0",
          total: "9007199254740993.00000001",
        },
      ]),
    });
    render(<AccountObservationPanel view={{ status: "CURRENT", observation: o, stale: false }} />);
    expect(screen.getByText(/free 9007199254740993.00000001/)).toBeInTheDocument();
  });
});
