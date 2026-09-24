import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConsoleStreamList } from "@/components/trader/admin-console/data/console-stream-list";
import { AdminQueryProvider } from "@/components/trader/admin-console/data/query-provider";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

class FakeSource extends EventTarget {
  static instances: FakeSource[] = [];
  closed = false;
  constructor(public url: string) {
    super();
    FakeSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(payload) }));
  }
}
function List({ url }: { url: string }) {
  const { items, reason } = useConsoleStreamList<{ id: string; symbol: string }>(url, "orders");
  return <div>{reason ?? items?.map((r) => r.symbol).join(",") ?? "loading"}</div>;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeSource.instances = [];
});
describe("admin read lifecycle", () => {
  it("ignores a late prior-scope response even if the transport ignores AbortSignal", async () => {
    const pending = new Map<string, (r: Response) => void>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => new Promise<Response>((resolve) => pending.set(url, resolve))),
    );
    vi.stubGlobal("EventSource", FakeSource);
    const a = "/read?organization_id=a";
    const b = "/read?organization_id=b";
    const view = render(<List url={a} />);
    view.rerender(<List url={b} />);
    await act(async () =>
      pending.get(b)!(
        Response.json({ cursor: "100", data: { items: [{ id: "b", symbol: "B only" }] } }),
      ),
    );
    expect(screen.getByText("B only")).toBeTruthy();
    await act(async () =>
      pending.get(a)!(
        Response.json({ cursor: "99", data: { items: [{ id: "a", symbol: "A secret" }] } }),
      ),
    );
    expect(screen.queryByText("A secret")).toBeNull();
    expect(FakeSource.instances).toHaveLength(1);
    expect(FakeSource.instances[0].url).toContain("organization_id=b");
    expect(FakeSource.instances[0].url).toContain("resume=100");
  });
  it("clears every query and removes all private UI when stream access is revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          cursor: "100",
          data: { items: [{ id: "a", symbol: "private position" }] },
        }),
      ),
    );
    vi.stubGlobal("EventSource", FakeSource);
    let queryClient: QueryClient | undefined;
    function PrivateView() {
      const client = useQueryClient();
      useEffect(() => {
        queryClient = client;
        client.setQueryData(["private"], { amount: "42" });
      }, [client]);
      return (
        <>
          <span>private controls</span>
          <List url="/read" />
        </>
      );
    }
    render(
      <AdminQueryProvider>
        <PrivateView />
      </AdminQueryProvider>,
    );
    await screen.findByText("private position");
    await act(async () =>
      FakeSource.instances[0].emit("access_revoked", {
        eventId: "revoked",
        type: "access_revoked",
        topic: "overview",
        entityId: "stream",
        entityVersion: "0",
        cursor: "0",
        payload: {},
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("Доступ к консоли отозван");
    expect(screen.queryByText("private controls")).toBeNull();
    expect(queryClient!.getQueryCache().getAll()).toHaveLength(0);
    expect(FakeSource.instances[0].closed).toBe(true);
  });
  it("treats HTTP permission loss as revocation rather than stale cached data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    vi.stubGlobal("EventSource", FakeSource);
    render(
      <AdminQueryProvider>
        <List url="/read" />
      </AdminQueryProvider>,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(FakeSource.instances).toHaveLength(0);
  });
});
